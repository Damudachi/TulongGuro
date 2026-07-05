// ─────────────────────────────────────────
// PII POLICY: Student names and personally identifiable information
// must NEVER be sent to external AI APIs (Gemini). Use anonymous
// identifiers (Student 1, Student 2, or truncated UUIDs) instead.
// This policy applies to: grading prompts, CoV prompts, chatbot prompts.
// ─────────────────────────────────────────

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
require('dotenv').config();
const { getAllTopics, getTopicById, getTopicAIGuidance } = require('./depedTopics');

const app = express();
const prisma = new PrismaClient();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// File storage: Supabase Storage in production, local disk in development
const useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
let supabase = null;
if (useSupabase) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  console.log('☁ Using Supabase Storage for file uploads');
} else {
  console.log('📁 Using local disk for file uploads (set SUPABASE_URL/KEY for cloud)');
}

// Local uploads dir (used in dev or as temp staging for sharp)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Helper: upload a local file to Supabase Storage and return public URL
async function uploadToCloud(localPath, filename) {
  if (!useSupabase) return `/uploads/${filename}`;
  const buffer = fs.readFileSync(localPath);
  const remotePath = `submissions/${filename}`;
  const { data, error } = await supabase.storage
    .from('uploads')
    .upload(remotePath, buffer, { contentType: 'image/jpeg', upsert: true });
  if (error) {
    console.log('⚠ Supabase upload failed, using local:', error.message);
    return `/uploads/${filename}`;
  }
  const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(remotePath);
  // Clean up local temp file in production
  if (process.env.NODE_ENV === 'production') {
    try { fs.unlinkSync(localPath); } catch {}
  }
  return urlData.publicUrl;
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'mock');
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: { responseMimeType: 'application/json' }
});
const modelLite = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: { responseMimeType: 'application/json' }
});
const chatModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// ─────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, schoolName } = req.body;

    // Check for existing email before attempting to create
    const existing = await prisma.user.findFirst({ where: { email } });
    if (existing) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists. Please log in instead.' });
    }

    const user = await prisma.user.create({
      data: { name, email, username: email, password, role: 'TEACHER', schoolName }
    });

    // Auto-seed Demo Sandbox for Onboarding
    try {
      const demoSection = await prisma.section.create({ data: { name: 'Grade 6 - Demo Section', teacherId: user.id } });
      const demoStudent = await prisma.user.create({
        data: { name: 'Demo Student', username: `DEMO-${Date.now()}`, password: 'password', role: 'STUDENT', sectionId: demoSection.id }
      });
      const demoClass = await prisma.class.create({
        data: { name: '[DEMO] Sandbox Demo Class', gradeLevel: 'Grade 6', subject: 'English', schoolYear: '2024-2025', teacherId: user.id, sectionId: demoSection.id }
      });
      const demoActivity = await prisma.activity.create({
        data: { title: 'Demo Activity: The Boy Who Cried Wolf', type: 'Essay', points: 100, classId: demoClass.id, instructions: 'Write a short summary.', submissionMode: 'TEACHER_UPLOAD' }
      });
      
      const aiFeedbackObj = JSON.stringify({
        strengths: "Great job completing your first assignment! You summarized the story well.",
        areasForGrowth: [{ studentQuote: "He was cry wolf.", explanation: "Make sure to use the correct past tense: 'He cried wolf'." }],
        actionableSteps: ["Review your verb tenses."],
        skillExplanations: { vocabulary: "Good basic words.", punctuation: "Mostly correct.", thematicFlow: "Easy to follow.", sentenceStructure: "A bit choppy." }
      });

      await prisma.submission.create({
        data: {
          studentId: demoStudent.id,
          activityId: demoActivity.id,
          imageUrl: '/demo-essay.png',
          aiScore: 85,
          aiFeedback: aiFeedbackObj,
          rubricData: JSON.stringify({ content: { score: 35, max: 40 }, organization: { score: 25, max: 30 }, grammar: { score: 25, max: 30 } }),
          skillScores: JSON.stringify({ vocabulary: 20, punctuation: 20, thematicFlow: 20, sentenceStructure: 20 }),
          status: 'PENDING_REVIEW' // Leave it pending so the teacher can try the HITL Workspace
        }
      });
    } catch (seedErr) {
      console.error('Failed to seed demo class:', seedErr);
    }

    res.json({ success: true, user });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    // Include related section data so clients receive up-to-date section info on login
    const user = await prisma.user.findFirst({
      where: { username, password, role },
      include: { section: true }
    });
    if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });

    // ── Student Sandbox: Auto-seed a demo graded essay on first login ──
    if (user.role === 'STUDENT') {
      try {
        const subCount = await prisma.submission.count({ where: { studentId: user.id } });
        if (subCount === 0 && user.sectionId) {
          // Find or create a system-level demo class linked to the student's section
          let demoClass = await prisma.class.findFirst({
            where: { name: '[STUDENT-DEMO] Sample Graded Work', sectionId: user.sectionId }
          });
          if (!demoClass) {
            // Need a teacher — find the section's teacher or any teacher
            const section = await prisma.section.findUnique({ where: { id: user.sectionId } });
            const teacherId = section?.teacherId || (await prisma.user.findFirst({ where: { role: 'TEACHER' } }))?.id;
            if (teacherId) {
              demoClass = await prisma.class.create({
                data: { name: '[STUDENT-DEMO] Sample Graded Work', gradeLevel: 'Grade 6', subject: 'English', schoolYear: '2024-2025', teacherId, sectionId: user.sectionId }
              });
            }
          }
          if (demoClass) {
            let demoActivity = await prisma.activity.findFirst({ where: { classId: demoClass.id } });
            if (!demoActivity) {
              demoActivity = await prisma.activity.create({
                data: { title: 'Sample Essay: My Favorite Place', type: 'Essay', points: 100, classId: demoClass.id, instructions: 'Write about your favorite place.', submissionMode: 'TEACHER_UPLOAD' }
              });
            }

            const demoFeedback = JSON.stringify({
              strengths: "You described your favorite place with a lot of feeling! Your teacher could really picture the scenery.",
              areasForGrowth: [{ studentQuote: "I go their every summer.", explanation: "The word 'their' should be 'there'. 'Their' shows ownership, 'there' shows a place." }],
              actionableSteps: ["Practice the difference between 'there', 'their', and 'they're'."],
              skillExplanations: { vocabulary: "Good use of descriptive words!", punctuation: "Most sentences end with periods.", thematicFlow: "Your ideas connect well.", sentenceStructure: "Try combining short sentences." }
            });

            await prisma.submission.create({
              data: {
                studentId: user.id,
                activityId: demoActivity.id,
                imageUrl: '/demo-essay.png',
                aiScore: 88,
                hitlScore: 90,
                aiFeedback: demoFeedback,
                hitlFeedback: demoFeedback,
                readingStrategy: "When you see an unfamiliar word, try breaking it into smaller parts (syllables) to sound it out.",
                rubricData: JSON.stringify({ content: { score: 36, max: 40 }, organization: { score: 27, max: 30 }, grammar: { score: 27, max: 30 } }),
                skillScores: JSON.stringify({ vocabulary: 22, punctuation: 21, thematicFlow: 23, sentenceStructure: 22 }),
                status: 'GRADED'
              }
            });
          }
        }
      } catch (seedErr) {
        console.error('Student sandbox seed error:', seedErr);
      }
    }

    res.json({ success: true, user });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// ONBOARDING: Quick Setup (creates Section + Class in one shot)
// ─────────────────────────────────────────
app.post('/api/teacher/quick-setup', async (req, res) => {
  try {
    const { teacherId, sectionName, subject, gradeLevel, schoolYear } = req.body;
    if (!teacherId || !sectionName || !subject || !gradeLevel) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const section = await tx.section.create({
        data: { name: sectionName.trim(), teacherId }
      });
      const cls = await tx.class.create({
        data: {
          name: `${subject} — ${gradeLevel}`,
          gradeLevel,
          subject,
          schoolYear: schoolYear || '2024-2025',
          teacherId,
          sectionId: section.id
        }
      });
      return { section, class: cls };
    });

    res.json({ success: true, ...result });
  } catch (e) {
    console.error('Quick setup error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// ONBOARDING: Delete Demo Data (child-first to avoid FK crash)
// ─────────────────────────────────────────
app.delete('/api/teacher/demo-data/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    const cls = await prisma.class.findUnique({
      where: { id: classId },
      include: { activities: { include: { submissions: true } }, section: true }
    });
    if (!cls) return res.status(404).json({ success: false, error: 'Class not found' });

    // Delete in FK-safe order: Submissions → Activities → Class → Demo Student → Section
    await prisma.$transaction(async (tx) => {
      // 1. Delete all submissions for all activities in this class
      const activityIds = cls.activities.map(a => a.id);
      if (activityIds.length > 0) {
        await tx.submission.deleteMany({ where: { activityId: { in: activityIds } } });
      }
      // 2. Delete all activities
      await tx.activity.deleteMany({ where: { classId } });
      // 3. Delete the class
      await tx.class.delete({ where: { id: classId } });
      // 4. Delete demo students in the section (only DEMO-* usernames)
      if (cls.sectionId) {
        await tx.user.deleteMany({
          where: { sectionId: cls.sectionId, username: { startsWith: 'DEMO-' } }
        });
        // 5. Delete the section if no other classes reference it
        const otherClasses = await tx.class.count({ where: { sectionId: cls.sectionId } });
        if (otherClasses === 0) {
          await tx.section.delete({ where: { id: cls.sectionId } });
        }
      }
    });

    res.json({ success: true, message: 'Demo data deleted successfully' });
  } catch (e) {
    console.error('Delete demo data error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// SECTIONS (school-wide, shared between teachers)
// ─────────────────────────────────────────
// Returns ALL sections — sections are homeroom groups, not teacher-owned
app.get('/api/teacher/:teacherId/sections', async (req, res) => {
  const sections = await prisma.section.findMany({
    include: { _count: { select: { students: true } }, students: { select: { id: true, name: true, username: true } } },
    orderBy: { name: 'asc' }
  });
  res.json({ success: true, sections });
});

app.post('/api/teacher/sections', async (req, res) => {
  try {
    const { name, teacherId, studentsList } = req.body;

    // 1) Check if a section with this exact name already exists
    let section = await prisma.section.findFirst({ where: { name: name.trim() } });
    let isExisting = false;

    if (section) {
      isExisting = true;
    } else {
      section = await prisma.section.create({ data: { name: name.trim(), teacherId } });
    }

    // 2) For each student name, check if they already exist ANYWHERE in the system
    //    A student should only have ONE account across all subjects/teachers
    const createdStudents = [];
    const skippedStudents = [];
    const linkedStudents = [];

    // Get existing students already in this section for numbering
    const sectionStudents = await prisma.user.findMany({
      where: { sectionId: section.id, role: 'STUDENT' }
    });
    const sectionNamesSet = new Set(sectionStudents.map(s => s.name.toLowerCase().trim()));
    let count = sectionStudents.length + 1;

    for (const studentName of studentsList) {
      if (!studentName.trim()) continue;
      const normalizedName = studentName.toLowerCase().trim();

      // Already in this section? Skip entirely
      if (sectionNamesSet.has(normalizedName)) {
        skippedStudents.push({ name: studentName.trim(), reason: 'Already in this section' });
        continue;
      }

      // Check if student exists ANYWHERE in the system (global dedup)
      const allStudents = await prisma.user.findMany({
        where: { role: 'STUDENT' }
      });
      const globalMatch = allStudents.find(s => s.name.toLowerCase().trim() === normalizedName);

      if (globalMatch) {
        // Student exists globally — move them to this section (their homeroom)
        await prisma.user.update({
          where: { id: globalMatch.id },
          data: { sectionId: section.id }
        });
        linkedStudents.push({ name: studentName.trim(), username: globalMatch.username, from: 'existing account' });
        sectionNamesSet.add(normalizedName);
        continue;
      }

      // Truly new student — create account
      const paddedNum = String(count).padStart(3, '0');
      const prefix = name.split('-')[1]?.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'SEC';
      let studentId = `${prefix}-${paddedNum}`;

      // Ensure username is unique
      while (await prisma.user.findUnique({ where: { username: studentId } })) {
        count++;
        studentId = `${prefix}-${String(count).padStart(3, '0')}`;
      }

      const user = await prisma.user.create({
        data: { name: studentName.trim(), username: studentId, password: 'password123', role: 'STUDENT', sectionId: section.id }
      });
      createdStudents.push(user);
      sectionNamesSet.add(normalizedName);
      count++;
    }

    let message = isExisting
      ? `Section "${section.name}" already exists. `
      : `Created section "${section.name}". `;
    if (createdStudents.length > 0) message += `${createdStudents.length} new account(s) created. `;
    if (linkedStudents.length > 0) message += `${linkedStudents.length} existing account(s) linked. `;
    if (skippedStudents.length > 0) message += `${skippedStudents.length} already in section.`;

    res.json({ success: true, section, createdStudents, skippedStudents, linkedStudents, message: message.trim() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// CLASSES
// ─────────────────────────────────────────
app.get('/api/teacher/:teacherId/classes', async (req, res) => {
  const classes = await prisma.class.findMany({
    where: { teacherId: req.params.teacherId },
    include: {
      section: { include: { _count: { select: { students: true } } } },
      _count: { select: { activities: true } },
      // Include recent activities so the teacher dashboard can show them directly
      activities: {
        include: { _count: { select: { submissions: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10
      }
    }
  });
  res.json({ success: true, classes });
});

app.post('/api/teacher/classes', async (req, res) => {
  try {
    const { name, gradeLevel, subject, schoolYear, teacherId, sectionId } = req.body;
    const newClass = await prisma.class.create({ data: { name, gradeLevel, subject, schoolYear, teacherId, sectionId } });
    res.json({ success: true, class: newClass });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/classes/:classId', async (req, res) => {
  const classData = await prisma.class.findUnique({
    where: { id: req.params.classId },
    include: {
      section: { include: { students: { select: { id: true, name: true, username: true } } } },
      activities: {
        include: {
          _count: { select: { submissions: true } },
          submissions: { select: { id: true, status: true, studentId: true } }
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  });
  res.json({ success: true, classData });
});

// Activities endpoint: accepts BOTH multipart/form-data (with files) and JSON (quick-create)
app.post('/api/teacher/activities', (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    upload.array('additionalFiles', 10)(req, res, next);
  } else {
    next();
  }
}, async (req, res) => {
  try {
    const { title, type, points, classId, instructions, deadline, submissionMode, rubric, topic } = req.body;
    const filePaths = (req.files || []).map(f => `/uploads/${f.filename}`);
    const activity = await prisma.activity.create({
      data: {
        title, type,
        topic: topic || null,
        points: parseInt(points) || 100,
        classId, instructions,
        deadline: deadline || null,
        submissionMode: submissionMode || 'TEACHER_UPLOAD',
        additionalFiles: filePaths.length ? JSON.stringify(filePaths) : null,
        rubric: rubric || null
      }
    });
    res.json({ success: true, activity });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Update activity details (deadline, instructions)
app.put('/api/teacher/activities/:activityId', async (req, res) => {
  try {
    const { title, type, points, topic, deadline, instructions } = req.body;
    const updateData = {};
    if (title !== undefined) updateData.title = String(title);
    if (type !== undefined) updateData.type = String(type);
    if (points !== undefined) updateData.points = parseInt(points);
    if (topic !== undefined) updateData.topic = topic ? String(topic) : null;
    if (deadline !== undefined) updateData.deadline = deadline ? String(deadline) : null;
    if (instructions !== undefined) updateData.instructions = instructions ? String(instructions) : null;

    const updated = await prisma.activity.update({
      where: { id: req.params.activityId },
      data: updateData
    });
    res.json({ success: true, activity: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Delete activity (Thesis-safe: delete child submissions first)
app.delete('/api/teacher/activities/:activityId', async (req, res) => {
  try {
    const { activityId } = req.params;
    await prisma.$transaction(async (tx) => {
      // Delete submissions linked to activity to prevent FK constraint failure
      await tx.submission.deleteMany({ where: { activityId } });
      // Delete the activity itself
      await tx.activity.delete({ where: { id: activityId } });
    });
    res.json({ success: true, message: 'Activity deleted safely' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// RUBRIC TEMPLATES
// ─────────────────────────────────────────
app.get('/api/teacher/rubric-templates/:teacherId', async (req, res) => {
  try {
    const templates = await prisma.rubricTemplate.findMany({
      where: { teacherId: req.params.teacherId },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, templates });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/teacher/rubric-templates', async (req, res) => {
  try {
    const { name, criteria, teacherId } = req.body;
    if (!name || !criteria || !teacherId) return res.status(400).json({ success: false, error: 'Missing fields' });
    
    const template = await prisma.rubricTemplate.create({
      data: {
        name: String(name),
        criteria: typeof criteria === 'string' ? criteria : JSON.stringify(criteria),
        teacherId: String(teacherId)
      }
    });
    res.json({ success: true, template });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Rubric generation removed — teachers must create rubrics manually or upload files.

// ─────────────────────────────────────────
// RUBRIC EXTRACTION (Gemini VLM reads uploaded rubric image/PDF)
// ─────────────────────────────────────────
app.post('/api/teacher/rubric/extract', upload.single('rubricFile'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: 'No rubric file provided' });

    // Read file and convert to base64
    const fileBuffer = fs.readFileSync(file.path);
    const base64Data = fileBuffer.toString('base64');
    const mimeType = file.mimetype || 'image/jpeg';

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: 'You are an expert at reading and parsing grading rubrics from images and documents. You extract structured rubric criteria with exact point values and descriptions. Output strict JSON only.'
    });

    const prompt = `Analyze this grading rubric document/image and extract ALL criteria.

Return a JSON object with this exact structure:
{
  "criteria": [
    {
      "name": "Criterion name",
      "description": "What this criterion evaluates",
      "points": 30,
      "bands": [
        { "range": "27-30", "score": 30, "label": "Excellent", "description": "Description of excellent performance" },
        { "range": "19-26", "score": 25, "label": "Very Good", "description": "Description of very good performance" },
        { "range": "10-18", "score": 15, "label": "Good", "description": "Description of good performance" },
        { "range": "0-9", "score": 5, "label": "Needs Improvement", "description": "Description of poor performance" }
      ]
    }
  ],
  "totalPoints": 100,
  "rubricType": "standard" or "range"
}

Rules:
- Extract EVERY criterion visible in the rubric
- If the rubric uses descriptive levels (Excellent, Very Good, Good, Fair, etc.) set rubricType to "range"
- If the rubric uses simple point allocations, set rubricType to "standard"
- If bands/levels are visible, include them in the bands array. Extract both the 'range' (string) and 'score' (number) for the band if present. If only a single number is given for a band, use it for the 'score'.
- If no bands are visible, leave bands as an empty array
- Ensure points add up correctly
- Return ONLY valid JSON, no markdown`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Data, mimeType } }
    ]);
    const response = await result.response;
    let text = response.text();
    // Clean markdown code blocks if present
    text = text.replace(/```json\n?|\n?```/gi, '').trim();

    const parsed = JSON.parse(text);
    if (!parsed.criteria || !Array.isArray(parsed.criteria)) {
      return res.status(422).json({ success: false, error: 'Could not extract rubric criteria from the uploaded file.' });
    }

    // Clean up the response
    const criteria = parsed.criteria.map(c => ({
      name: c.name || 'Unnamed Criterion',
      description: c.description || '',
      points: parseInt(c.points) || 0,
      bands: Array.isArray(c.bands) ? c.bands.map(b => ({
        range: b.range || '',
        score: parseInt(b.score) || 0,
        label: b.label || '',
        description: b.description || ''
      })) : []
    }));

    res.json({
      success: true,
      criteria,
      totalPoints: parsed.totalPoints || criteria.reduce((s, c) => s + c.points, 0),
      rubricType: parsed.rubricType || 'standard'
    });
  } catch (e) {
    console.error('Rubric extraction error:', e);
    res.status(500).json({ success: false, error: 'Failed to extract rubric: ' + e.message });
  }
});

app.get('/api/activities/:activityId/submissions', async (req, res) => {
  const submissions = await prisma.submission.findMany({
    where: { activityId: req.params.activityId },
    include: { student: { select: { id: true, name: true, username: true } } },
    orderBy: { createdAt: 'desc' }
  });
  res.json({ success: true, submissions });
});

// ─────────────────────────────────────────
// FEATURE 1: Edge-Based Image Optimization
// Minimal non-destructive pipeline: EXIF rotation fix + JPEG compression only
// The VLM reads color photos natively — NO binarization, NO filters, NO sharpening
// ─────────────────────────────────────────
async function preprocessImage(inputPath) {
  const outputPath = inputPath.replace(/(\.[^.]+)$/, '-processed.jpg');
  try {
    await sharp(inputPath)
      .rotate()                               // EXIF auto-rotation: fix phone camera orientation
      .resize({ width: 1920, withoutEnlargement: true }) // Cap at 1920px: reduce upload size
      .jpeg({ quality: 88 })                  // Compress to JPEG: save mobile data
      .toFile(outputPath);
    const origSize = fs.statSync(inputPath).size;
    const newSize = fs.statSync(outputPath).size;
    console.log(`📷 Preprocessed: ${Math.round(origSize / 1024)}KB → ${Math.round(newSize / 1024)}KB`);
    return outputPath;
  } catch (e) {
    console.log('⚠ Image preprocessing fallback (using original):', e.message);
    return inputPath;
  }
}

// ─────────────────────────────────────────
// VLM UPLOAD (Gemini Vision)
// ─────────────────────────────────────────
app.post('/api/teacher/upload', upload.single('image'), async (req, res) => {
  try {
    const { studentId, activityId } = req.body;
    const imageFile = req.file;
    if (!imageFile) return res.status(400).json({ error: 'No image provided' });
    // Require a real student to be assigned before AI grading
    if (!studentId || studentId === 'mock-student-id') {
      return res.status(400).json({ success: false, error: 'Please assign a student before grading. A student must be selected.' });
    }

    const imageUrl = `/uploads/${imageFile.filename}`;

    // 1) Preprocess the image
    const processedPath = await preprocessImage(imageFile.path);
    const processedFilename = path.basename(processedPath);
    // Upload to Supabase Storage in production, local path in dev
    const processedUrl = await uploadToCloud(processedPath, processedFilename);

    // 2) Fetch activity rubric context (with banded scoring support)
    let rubricContext = 'Use standard DepEd essay rubric: Content & Ideas (40 pts: 35-40 Outstanding, 25-34 Proficient, 15-24 Developing, 0-14 Beginning), Organization (30 pts: 27-30 Outstanding, 19-26 Proficient, 10-18 Developing, 0-9 Beginning), Language & Grammar (30 pts: 27-30 Outstanding, 19-26 Proficient, 10-18 Developing, 0-9 Beginning).';
    let activityContext = '';
    let subjectForPrompt = 'English';
    if (activityId && activityId !== 'mock-activity-id') {
      const activity = await prisma.activity.findUnique({ where: { id: activityId }, include: { class: { select: { subject: true } } } });
      if (activity) {
        activityContext = `Activity: "${activity.title}" (${activity.type}). Instructions: "${activity.instructions || 'N/A'}".`;
        if (activity.class?.subject) subjectForPrompt = activity.class.subject;
        if (activity.rubric) {
          try {
            const parsed = JSON.parse(activity.rubric);
            if (parsed.criteria?.length) {
              const isRangeType = parsed.type === 'range';
              if (isRangeType) {
                // Range-type rubric: use descriptive band levels
                rubricContext = 'RUBRIC TYPE: Range/Levels-based grading.\nUse this rubric:\n' + parsed.criteria.map(c => {
                  let bandStr = '';
                  if (c.bands?.length) {
                    bandStr = '\n  Scoring levels:\n' + c.bands.map(b =>
                      `    - ${b.label} (${b.score || b.range}): ${b.description}`
                    ).join('\n');
                  }
                  return `• ${c.name}: ${c.description || ''}${bandStr}`;
                }).join('\n') + '\nFor each criterion, assign the appropriate level/band label and provide justification. The final score should be computed from the band scores.';
              } else {
                // Standard point-based rubric
                rubricContext = 'Use this rubric:\n' + parsed.criteria.map(c => {
                  let bandStr = '';
                  if (c.bands?.length) {
                    bandStr = ' Scoring bands: ' + c.bands.map(b => `${b.range} ${b.label}: ${b.description}`).join('; ');
                  }
                  return `• ${c.name} (${c.points} pts): ${c.description || ''}${bandStr}`;
                }).join('\n') + '\nGrade each criterion within these bands and justify your score placement.';
              }
            }
          } catch { }
        }
      }
    }

    // 3) Mini-RAG — fetch teacher's past grading examples
    let fewShotExamples = '';
    if (activityId && activityId !== 'mock-activity-id') {
      const activity = await prisma.activity.findUnique({ where: { id: activityId }, include: { class: true } });
      const teacherId = activity?.class?.teacherId;
      if (teacherId) {
        const examples = await prisma.gradingExample.findMany({
          where: { teacherId, activityType: activity?.type || 'Essay' },
          orderBy: { createdAt: 'desc' },
          take: 3
        });
        if (examples.length > 0) {
          fewShotExamples = '\n\nIMPORTANT — TEACHER GRADING STYLE EXAMPLES (adapt your feedback to match this teacher\'s tone and expectations):\n' +
            examples.map((ex, i) => `Example ${i + 1}: AI originally wrote: "${ex.aiFeedback}" | Teacher changed it to: "${ex.teacherFeedback}" | AI score was ${ex.aiScore}, teacher gave ${ex.teacherScore}`).join('\n');
        }
      }
    }

    // 3b) Few-Shot Section Memory — fetch recent teacher-approved submissions from the same section
    let sectionContext = '';
    if (activityId && activityId !== 'mock-activity-id') {
      try {
        const actForSection = await prisma.activity.findUnique({ where: { id: activityId }, include: { class: { select: { sectionId: true } } } });
        const sectionId = actForSection?.class?.sectionId;
        if (sectionId) {
          const recentGraded = await prisma.submission.findMany({
            where: {
              status: 'GRADED',
              activity: { class: { sectionId } }
            },
            orderBy: { updatedAt: 'desc' },
            take: 3,
            select: {
              hitlScore: true,
              hitlFeedback: true,
              student: { select: { name: true } },
              activity: { select: { title: true, type: true } }
            }
          });
          if (recentGraded.length > 0) {
            sectionContext = '\n\nSECTION CONTEXT — Recent teacher-approved work from this section (use as baseline for this section\'s level):\n' +
              recentGraded.map((s, i) => {
                let fb = s.hitlFeedback || '';
                try { const p = JSON.parse(fb); fb = p.strengths || fb; } catch {}
                return `Student ${i + 1}: Score ${s.hitlScore}/100 for "${s.activity?.title}" — Feedback: "${fb.slice(0, 150)}..."`;
              }).join('\n');
          }
        }
      } catch { /* section context is optional, don't break grading */ }
    }

    // 4) Get topic-specific AI evaluation guidance
    let topicGuidance = '';
    if (activityId && activityId !== 'mock-activity-id') {
      const actForTopic = await prisma.activity.findUnique({ where: { id: activityId }, select: { topic: true } });
      if (actForTopic?.topic) {
        topicGuidance = getTopicAIGuidance(actForTopic.topic);
      }
    }

    // 5) Build the prompt — includes no-text detection + pedagogical tutor persona
    // Get grade level from activity context for age-appropriate feedback
    let gradeLevelForPrompt = 'Grade 6';
    if (activityId && activityId !== 'mock-activity-id') {
      const actForLevel = await prisma.activity.findUnique({ where: { id: activityId }, include: { class: { select: { gradeLevel: true } } } });
      if (actForLevel?.class?.gradeLevel) gradeLevelForPrompt = actForLevel.class.gradeLevel;
    }

    // Determine language complexity based on grade level
    const gradeNum = parseInt(gradeLevelForPrompt.replace(/\D/g, '')) || 6;
    const languageGuide = gradeNum <= 3
      ? 'Use very simple, encouraging language. Short sentences. Think of how a kind Ate/Kuya would talk to a young child.'
      : gradeNum <= 6
        ? 'Use clear academic language appropriate for upper elementary students. Be specific but not overwhelming.'
        : gradeNum <= 8
          ? 'Use academic language appropriate for junior high school. You can introduce more complex terms but always explain them.'
          : gradeNum <= 10
            ? 'Use formal academic language. Expect higher-order thinking and cite specific literary/rhetorical concepts when relevant.'
            : 'Use college-prep academic language. Reference disciplinary literacy standards and analytical frameworks.';

    // DepEd MATATAG Curriculum Context by Grade Level
    const curriculumContext = `
CURRICULUM CONTEXT (DepEd K-12 MATATAG, ${subjectForPrompt}, ${gradeLevelForPrompt}):
${gradeNum <= 3 ? '- Focus: Simple sentence construction, basic narrative writing, phonics-based spelling, picture-prompted writing.' :
  gradeNum <= 4 ? '- Focus: Paragraph writing, personal narratives, descriptive writing, basic grammar (subject-verb agreement, tenses).' :
  gradeNum <= 6 ? '- Focus: Multi-paragraph essays, opinion/persuasive writing, basic research skills, formal letter writing, text-based evidence.' :
  gradeNum <= 8 ? '- Focus: Formal essay structure (5-paragraph), persuasive/argumentative writing, literary analysis, note-taking, summarizing.' :
  gradeNum <= 10 ? '- Focus: Advanced argumentative essays, research papers, critical analysis, literary criticism, position papers.' :
  '- Focus: Academic writing, disciplinary literacy, advanced research papers, position papers, technical writing.'}
- Evaluate this student's work against the standards expected at ${gradeLevelForPrompt} — not against college-level expectations.
- A ${gradeLevelForPrompt} student who writes well for their age should score 75-85. Reserve 90+ for truly exceptional work at this level.
`;

    const prompt = `You are a warm, encouraging Filipino tutor ("Guro") giving constructive feedback to a ${gradeLevelForPrompt} student studying ${subjectForPrompt} in a Philippine public school (DepEd K-12 MATATAG curriculum).

${curriculumContext}

YOUR TEACHING PHILOSOPHY:
- Always start with genuine praise — find something the student did well, no matter how small.
- When pointing out mistakes, SHOW the student their exact words so they can see the error themselves.
- Give bite-sized, concrete action steps — not vague advice like "improve your grammar."
- ${languageGuide}

${activityContext}
${rubricContext}${fewShotExamples}${sectionContext}${topicGuidance}

IMPORTANT RULES:
- First, check if the image contains readable handwritten or printed text.
- If the image is BLANK, contains only drawings/art with no text, is too blurry to read, or has NO readable written content, you MUST set score to 0, set noTextDetected to true, provide a short explanation in strengths, and leave areasForGrowth and actionableSteps as empty arrays.
- If you CAN read text, grade it normally against the rubric using the structured feedback format below.
- DATA PRIVACY RULE: Do NOT mention or include the student's name anywhere in your feedback. If you detect a student's name written on the paper, set "privacyViolationDetected" to true.${subjectForPrompt.toLowerCase().includes('filipino') ? '\n- LANGUAGE RULE: You MUST write the strengths, areasForGrowth, actionableSteps, skillExplanations, and readingStrategy entirely in Tagalog/Filipino.' : subjectForPrompt.toLowerCase().includes('english') ? '\n- LANGUAGE RULE: You MUST write the strengths, areasForGrowth, actionableSteps, skillExplanations, and readingStrategy entirely in English.' : ''}

TASK: In ONE step:
1. Read and transcribe the handwritten student essay from the image.
2. Grade it against the rubric.
3. Provide structured, evidence-based tutoring feedback.
4. Generate a personalized reading intervention strategy connected to the weaknesses found.

You MUST respond with valid JSON matching this exact schema:
{
  "score": <total 0-100, use 0 if no readable text>,
  "contentScore": <number>, "contentMax": <number>,
  "organizationScore": <number>, "organizationMax": <number>,
  "grammarScore": <number>, "grammarMax": <number>,
  "strengths": "<1-3 sentences about what the student did well. Be specific — reference their actual ideas or phrases.>",
  "areasForGrowth": [
    {
      "studentQuote": "<Copy the EXACT sentence or phrase from the student's essay that contains the error. Must be a real quote from their writing.>",
      "explanation": "<In simple terms, explain what's wrong and how to fix it. Be kind.>"
    }
  ],
  "actionableSteps": [
    "<A concrete, bite-sized task the student can do to improve. e.g., 'Try rewriting your second sentence using the word Because to connect your ideas.'>"
  ],
  "skillExplanations": {
    "vocabulary": "<1 sentence explaining why you gave this vocabulary score>",
    "punctuation": "<1 sentence explaining why you gave this punctuation score>",
    "thematicFlow": "<1 sentence explaining why you gave this thematic flow score>",
    "sentenceStructure": "<1 sentence explaining why you gave this sentence structure score>"
  },
  "readingStrategy": "<Personalized 2-sentence reading strategy directly connected to the weaknesses above. Or 'N/A' if no text found.>",
  "noTextDetected": <true if image has no readable text, false otherwise>,
  "privacyViolationDetected": <true if you can clearly read a student's name written anywhere on the paper, false otherwise>,
  "skillScores": {
    "vocabulary": <0-25>,
    "punctuation": <0-25>,
    "thematicFlow": <0-25>,
    "sentenceStructure": <0-25>
  }
}

RULES FOR areasForGrowth:
- Include 1-3 items. Focus on the most impactful issues.
- studentQuote MUST be copied exactly from the student's handwriting (even if it has errors — that's the point).
- Do NOT invent quotes. If you cannot read a specific phrase, say so honestly.

RULES FOR actionableSteps:
- Include 1-2 items maximum.
- Each step must be something the student can do in 5 minutes or less.
- Be specific: "Rewrite your opening sentence to include the word 'dahil'" is better than "Work on your transitions."

RULES FOR skillExplanations:
- Each explanation should reference specific evidence from the essay.
- Keep each to 1 sentence.`;

    // Track AI source for transparency
    let aiSource = 'mock';  // 'gemini' | 'gemini-lite' | 'mock'
    let aiError = null;

    let aiResult = null;

    // Robust JSON parsing with retry logic
    async function callGemini(m, parts, retries = 2) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const result = await m.generateContent(parts);
          const text = result.response.text();
          // Clean up common Gemini output artifacts
          let cleaned = text
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/g, '')
            .replace(/^[^{]*/, '')  // Remove anything before the first {
            .replace(/[^}]*$/, '')  // Remove anything after the last }
            .trim();
          return JSON.parse(cleaned);
        } catch (parseErr) {
          if (attempt < retries) {
            console.log(`⚠ JSON parse attempt ${attempt + 1} failed, retrying... (${parseErr.message?.slice(0, 60)})`);
            // Small delay before retry
            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          } else {
            throw parseErr;
          }
        }
      }
    }

    const imgBuffer = fs.readFileSync(processedPath);
    const imageParts = [{ inlineData: { data: imgBuffer.toString('base64'), mimeType: 'image/jpeg' } }];

    // Primary grading call
    try {
      aiResult = await callGemini(model, [prompt, ...imageParts]);
      aiSource = 'gemini';
      console.log('✅ Gemini graded:', aiResult.score, '/ 100', aiResult.noTextDetected ? '(NO TEXT DETECTED)' : '');
    } catch (e) {
      const errMsg = e.message || String(e);
      console.log('⚠ Primary model failed:', errMsg.slice(0, 200));
      // Try lite model
      try {
        aiResult = await callGemini(modelLite, [prompt, ...imageParts]);
        aiSource = 'gemini-lite';
        console.log('✅ Gemini-lite graded:', aiResult.score, '/ 100');
      } catch (e2) {
        const errMsg2 = e2.message || String(e2);
        console.log('⚠ Lite model also failed:', errMsg2.slice(0, 200));
        aiError = `AI grading failed. Primary: ${errMsg.slice(0, 100)} | Lite: ${errMsg2.slice(0, 100)}`;
        // Use placeholder — but mark it clearly as mock
        aiResult = {
          score: 0, contentScore: 0, contentMax: 40,
          organizationScore: 0, organizationMax: 30,
          grammarScore: 0, grammarMax: 30,
          strengths: `⚠ AI grading is currently unavailable. Error: ${errMsg.slice(0, 120)}. The teacher will need to grade this manually.`,
          areasForGrowth: [],
          actionableSteps: [],
          skillExplanations: { vocabulary: 'N/A', punctuation: 'N/A', thematicFlow: 'N/A', sentenceStructure: 'N/A' },
          readingStrategy: 'AI was unable to analyze this submission. Manual review required.',
          noTextDetected: false,
          skillScores: { vocabulary: 0, punctuation: 0, thematicFlow: 0, sentenceStructure: 0 }
        };
      }
    }

    // Chain-of-Verification — SKIPPED by default during upload for speed
    // Teacher can trigger verification from the HITL review page via /api/teacher/submissions/:id/verify
    let covData = null;
    const runCoV = req.query.verify === 'true' || req.body.verify === true;
    if (runCoV && aiSource !== 'mock' && !aiResult.noTextDetected) {
      const originalScore = aiResult.score;
      try {
        const covPrompt = `You previously graded this handwritten student essay and produced this result:
- Content: ${aiResult.contentScore}/${aiResult.contentMax}
- Organization: ${aiResult.organizationScore}/${aiResult.organizationMax}
- Grammar: ${aiResult.grammarScore}/${aiResult.grammarMax}
- Total: ${aiResult.score}/100
- Feedback: "${aiResult.strengths}"

${rubricContext}

Now VERIFY: Re-examine the image carefully. Is this grade fair and accurate?
If correct, return the same scores. If you find an error, correct it.
Respond with JSON ONLY using the same schema as before.`;

        const verifiedResult = await callGemini(model, [covPrompt, ...imageParts]);
        const scoreDelta = Math.abs(verifiedResult.score - originalScore);
        const conflict = scoreDelta > 10;
        covData = { originalScore, verifiedScore: verifiedResult.score, conflict, delta: scoreDelta };

        if (conflict) {
          console.log(`🔍 CoV conflict: ${originalScore} → ${verifiedResult.score} (Δ${scoreDelta})`);
          aiResult = verifiedResult;
        } else {
          console.log(`✅ CoV confirmed: ${aiResult.score}`);
        }
      } catch (e) {
        console.log('⚠ CoV skipped:', e.message?.slice(0, 80));
      }
    }

    // Serialize the structured feedback as JSON string for storage
    const structuredFeedback = JSON.stringify({
      strengths: aiResult.strengths || '',
      areasForGrowth: aiResult.areasForGrowth || [],
      actionableSteps: aiResult.actionableSteps || [],
      skillExplanations: aiResult.skillExplanations || {}
    });

    // GRADE RETENTION POLICY: Compute retainUntil (1 year after school year end)
    let retainUntil = null;
    if (activityId && activityId !== 'mock-activity-id') {
      try {
        const actForRetention = await prisma.activity.findUnique({
          where: { id: activityId },
          include: { class: { select: { schoolYear: true } } }
        });
        if (actForRetention?.class?.schoolYear) {
          // Parse school year like "2025-2026" → end year 2026 → retain until June 30, 2027
          const syMatch = actForRetention.class.schoolYear.match(/(\d{4})\s*-\s*(\d{4})/);
          if (syMatch) {
            const endYear = parseInt(syMatch[2]);
            retainUntil = new Date(endYear + 1, 5, 30); // June 30 of endYear+1
          }
        }
      } catch { /* retention date is optional, don't break submission */ }
    }

    const submission = await prisma.submission.create({
      data: {
        studentId: studentId || 'mock-student-id',
        activityId: activityId || 'mock-activity-id',
        imageUrl: processedUrl,
        aiScore: aiResult.score,
        hitlScore: aiResult.score,
        aiFeedback: structuredFeedback,
        privacyViolation: aiResult.privacyViolationDetected || false,
        readingStrategy: aiResult.readingStrategy,
        rubricData: JSON.stringify({
          content: { score: aiResult.contentScore, max: aiResult.contentMax },
          organization: { score: aiResult.organizationScore, max: aiResult.organizationMax },
          grammar: { score: aiResult.grammarScore, max: aiResult.grammarMax }
        }),
        skillScores: aiResult.skillScores ? JSON.stringify(aiResult.skillScores) : null,
        covData: covData ? JSON.stringify(covData) : null,
        retainUntil,
        status: 'PENDING'
      }
    });

    res.json({
      success: true,
      submission,
      aiResult,
      covData,
      aiSource,           // 'gemini' | 'gemini-lite' | 'mock'
      aiError,            // null if AI worked, error string if it failed
      noTextDetected: aiResult.noTextDetected || false,
      privacyViolationDetected: aiResult.privacyViolationDetected || false
    });
  } catch (e) {
    console.log('❌ Upload endpoint error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// HITL WORKSPACE
// ─────────────────────────────────────────
app.get('/api/submissions/:id', async (req, res) => {
  const sub = await prisma.submission.findUnique({
    where: { id: req.params.id },
    include: { student: true, activity: { include: { class: true } } }
  });
  res.json({ success: true, submission: sub });
});

app.post('/api/teacher/refine', async (req, res) => {
  try {
    const { currentFeedback, prompt: teacherPrompt } = req.body;
    const sys = `You are a helpful teaching assistant for Philippine public school teachers.
Your job is to rewrite student feedback based on the teacher's instruction.
Keep the tone warm, encouraging, and developmentally appropriate for K-12 students.
Return ONLY the rewritten feedback text — no markdown, no quotes, no labels.

Current Feedback:
"${currentFeedback}"

Teacher's instruction: ${teacherPrompt}`;

    let refinedFeedback = `Here is an improved version: ${currentFeedback} This student shows great potential!`;
    try {
      const result = await chatModel.generateContent(sys);
      refinedFeedback = result.response.text().trim();
    } catch (e) {
      console.log('⚠ AI refine failed:', e.message?.slice(0, 80));
    }
    res.json({ success: true, refinedFeedback });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/teacher/submissions/:id/grade', async (req, res) => {
  try {
    const { hitlScore, hitlFeedback, readingStrategy, rubricData, teacherId } = req.body;
    const sub = await prisma.submission.findUnique({
      where: { id: req.params.id },
      include: { activity: { include: { class: true } } }
    });

    const updated = await prisma.submission.update({
      where: { id: req.params.id },
      data: { hitlScore: parseInt(hitlScore), hitlFeedback, readingStrategy, rubricData: JSON.stringify(rubricData), status: 'GRADED' }
    });

    // FEATURE 5: Mini-RAG capture — save as grading example if teacher meaningfully changed the AI result
    if (sub && teacherId) {
      const scoreDelta = Math.abs(parseInt(hitlScore) - (sub.aiScore || 0));
      const feedbackChanged = hitlFeedback && hitlFeedback !== sub.aiFeedback;
      if (scoreDelta >= 5 || feedbackChanged) {
        const activityType = sub.activity?.type || 'Essay';
        const gradeLevel = sub.activity?.class?.gradeLevel || null;
        await prisma.gradingExample.create({
          data: {
            teacherId,
            activityType,
            gradeLevel,
            aiFeedback: sub.aiFeedback || '',
            teacherFeedback: hitlFeedback || sub.aiFeedback || '',
            aiScore: sub.aiScore || 0,
            teacherScore: parseInt(hitlScore)
          }
        });
        console.log(`📚 Mini-RAG: Saved grading example (Δ${scoreDelta}pts, feedbackChanged=${feedbackChanged})`);
      }
    }

    res.json({ success: true, submission: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// FEATURE 7: Predictive Early Warning Analytics
// ─────────────────────────────────────────
app.get('/api/teacher/:teacherId/analytics', async (req, res) => {
  try {
    const { classId, sectionId } = req.query;
    // Get all classes for this teacher, optionally filtered
    const whereClause = { teacherId: req.params.teacherId };
    if (classId) whereClause.id = classId;
    if (sectionId) whereClause.sectionId = sectionId;
    // Get all classes for this teacher
    const classes = await prisma.class.findMany({
      where: whereClause,
      include: { section: { include: { students: { select: { id: true, name: true, username: true } } } } }
    });

    const allStudentIds = classes.flatMap(c => c.section?.students || []);
    const uniqueStudents = [...new Map(allStudentIds.map(s => [s.id, s])).values()];

    // Get last 3 graded submissions per student
    const warnings = [];
    const studentTrends = [];
    const SKILLS = ['vocabulary', 'punctuation', 'thematicFlow', 'sentenceStructure'];

    for (const student of uniqueStudents) {
      const subs = await prisma.submission.findMany({
        where: { studentId: student.id, status: 'GRADED', skillScores: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 3,
        include: { activity: { select: { title: true } } }
      });

      if (subs.length < 2) continue;

      const skillHistory = subs.reverse().map(s => {
        try { return JSON.parse(s.skillScores); } catch { return null; }
      }).filter(Boolean);

      const studentWarnings = [];
      for (const skill of SKILLS) {
        const scores = skillHistory.map(h => h[skill] || 0);
        // Check for 2 consecutive drops
        if (scores.length >= 2) {
          const allDropping = scores.slice(1).every((v, i) => v < scores[i]);
          if (allDropping) {
            studentWarnings.push({
              skill,
              trend: scores,
              severity: scores[0] - scores[scores.length - 1] > 5 ? 'HIGH' : 'MEDIUM'
            });
          }
        }
      }

      const latestSub = subs[subs.length - 1];
      const latestScores = skillHistory[skillHistory.length - 1] || {};
      studentTrends.push({
        student,
        latestScore: latestSub?.hitlScore || latestSub?.aiScore || 0,
        skillScores: latestScores,
        history: skillHistory
      });

      if (studentWarnings.length > 0) {
        warnings.push({ student, warnings: studentWarnings });
      }
    }

    // Class-wide averages per skill
    const classAvgSkills = {};
    SKILLS.forEach(skill => {
      const vals = studentTrends.map(st => st.skillScores?.[skill] || 0).filter(v => v > 0);
      classAvgSkills[skill] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    });

    // Get sections for the section picker
    const allSections = classes.reduce((acc, c) => {
      if (c.section && !acc.find(s => s.id === c.section.id)) {
        acc.push({ id: c.section.id, name: c.section.name, studentCount: c.section.students?.length || 0 });
      }
      return acc;
    }, []);

    res.json({ success: true, warnings, studentTrends, classAvgSkills, warningCount: warnings.length, sections: allSections });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Per-student analytics detail
app.get('/api/teacher/student/:studentId/analytics', async (req, res) => {
  try {
    const student = await prisma.user.findUnique({
      where: { id: req.params.studentId },
      select: { id: true, name: true, username: true }
    });
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' });

    const submissions = await prisma.submission.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: 'asc' },
      include: { activity: { select: { title: true, type: true, points: true, classId: true, class: { select: { name: true } } } } }
    });

    const SKILLS = ['vocabulary', 'punctuation', 'thematicFlow', 'sentenceStructure'];
    const skillHistory = submissions
      .filter(s => s.skillScores)
      .map(s => {
        try { return { ...JSON.parse(s.skillScores), activityTitle: s.activity?.title, date: s.createdAt }; }
        catch { return null; }
      }).filter(Boolean);

    // Calculate averages
    const avgScore = submissions.length
      ? Math.round(submissions.reduce((sum, s) => sum + (s.hitlScore ?? s.aiScore ?? 0), 0) / submissions.length)
      : 0;

    const avgSkills = {};
    SKILLS.forEach(skill => {
      const vals = skillHistory.map(h => h[skill] || 0).filter(v => v > 0);
      avgSkills[skill] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    });

    res.json({
      success: true, student, submissions: submissions.map(s => ({
        id: s.id, activityTitle: s.activity?.title, activityType: s.activity?.type,
        className: s.activity?.class?.name, points: s.activity?.points,
        aiScore: s.aiScore, hitlScore: s.hitlScore, status: s.status,
        imageUrl: s.imageUrl, aiFeedback: s.aiFeedback, hitlFeedback: s.hitlFeedback,
        createdAt: s.createdAt
      })),
      skillHistory, avgScore, avgSkills, totalSubmissions: submissions.length
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// STUDENT ROUTES
// ─────────────────────────────────────────
app.get('/api/student/:studentId/dashboard', async (req, res) => {
  try {
    const student = await prisma.user.findUnique({
      where: { id: req.params.studentId },
      include: { section: { include: { classes: true } } }
    });
    const submissions = await prisma.submission.findMany({
      where: { studentId: req.params.studentId, status: 'GRADED' },
      include: { activity: { include: { class: true } } },
      orderBy: { updatedAt: 'desc' }
    });
    const avgGrade = submissions.length
      ? Math.round(submissions.reduce((s, sub) => s + (sub.hitlScore || sub.aiScore || 0), 0) / submissions.length)
      : 0;
    const stars = submissions.filter(s => (s.hitlScore || s.aiScore || 0) >= 90).length * 3
      + submissions.filter(s => { const sc = s.hitlScore || s.aiScore || 0; return sc >= 75 && sc < 90; }).length;

    // Dynamically calculate avgSkills from recent submissions
    const SKILLS = ['vocabulary', 'punctuation', 'thematicFlow', 'sentenceStructure'];
    const avgSkills = {};
    const skillTrend = submissions.filter(s => s.skillScores).map(s => {
      try { return JSON.parse(s.skillScores); } catch { return null; }
    }).filter(Boolean);
    SKILLS.forEach(skill => {
      const vals = skillTrend.map(h => h[skill] || 0).filter(v => v > 0);
      avgSkills[skill] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    });

    // Extract latestStrategy from the most recent graded submission
    const latestStrategy = submissions[0]?.readingStrategy || null;

    // Fetch upcoming deadlines (all deadlines that are not in the past)
    const classIds = student?.section?.classes?.map(c => c.id) || [];
    const upcomingActivities = await prisma.activity.findMany({
      where: {
        classId: { in: classIds },
        deadline: { not: null }
      }
    });
    const now = new Date();
    // Exclude activities the student has already submitted
    const submittedActivityIds = submissions.map(s => s.activityId);
    
    const upcomingDeadlines = upcomingActivities.filter(a => {
      if (submittedActivityIds.includes(a.id)) return false;
      const deadlineDate = new Date(a.deadline);
      return deadlineDate >= now || isNaN(deadlineDate); // Include if valid future date or format that doesn't parse to past
    }).map(a => ({
      id: a.id,
      title: a.title,
      deadline: a.deadline
    })).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

    res.json({ success: true, student, submissions, avgGrade, stars, avgSkills, latestStrategy, upcomingDeadlines });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// GRADEBOOK
// ─────────────────────────────────────────
app.get('/api/teacher/:teacherId/gradebook', async (req, res) => {
  try {
    const { classId } = req.query;
    const whereClause = classId ? { classId } : { class: { teacherId: req.params.teacherId } };
    const activities = await prisma.activity.findMany({
      where: whereClause,
      include: {
        class: true,
        submissions: {
          include: { student: { select: { id: true, name: true, username: true } } }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    // Also get all students for each class
    const classes = await prisma.class.findMany({
      where: { teacherId: req.params.teacherId },
      include: { section: { include: { students: { select: { id: true, name: true, username: true } } } } }
    });
    res.json({ success: true, activities, classes });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// STUDENT ACTIVITIES (for self-submission)
// ─────────────────────────────────────────
app.get('/api/student/:studentId/activities', async (req, res) => {
  try {
    const student = await prisma.user.findUnique({
      where: { id: req.params.studentId },
      include: {
        section: {
          include: {
            classes: {
              include: {
                activities: {
                  where: { submissionMode: 'STUDENT_SUBMIT' }, // Only show student-submit activities
                  orderBy: { createdAt: 'desc' }
                }
              }
            }
          }
        }
      }
    });
    const activities = student?.section?.classes?.flatMap(c =>
      c.activities.map(a => ({ ...a, className: c.name }))
    ) || [];
    // Check which ones student already submitted
    const mySubmissions = await prisma.submission.findMany({
      where: { studentId: req.params.studentId },
      select: { activityId: true, status: true, id: true }
    });
    const submissionMap = {};
    mySubmissions.forEach(s => { submissionMap[s.activityId] = s; });
    const activitiesWithStatus = activities.map(a => ({
      ...a,
      mySubmission: submissionMap[a.id] || null
    }));
    res.json({ success: true, activities: activitiesWithStatus });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Student self-submission — stores image only, NO AI grading (teacher triggers AI via HITL)
app.post('/api/student/submit', upload.single('image'), async (req, res) => {
  try {
    const { studentId, activityId } = req.body;
    const imageFile = req.file;
    if (!imageFile) return res.status(400).json({ error: 'No image provided' });
    const imageUrl = `/uploads/${imageFile.filename}`;

    // Check for existing submission and update, or create new
    const existing = await prisma.submission.findFirst({ where: { studentId, activityId } });
    let submission;
    if (existing) {
      submission = await prisma.submission.update({
        where: { id: existing.id },
        data: { imageUrl, status: 'PENDING', aiScore: null, hitlScore: null, aiFeedback: null }
      });
    } else {
      submission = await prisma.submission.create({
        data: { studentId, activityId, imageUrl, status: 'PENDING' }
      });
    }
    res.json({ success: true, submission });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// STUDENT CHATBOT (AI Study Buddy)
// ─────────────────────────────────────────
app.post('/api/student/chat', async (req, res) => {
  try {
    const { studentId, message, conversationHistory = [], context: specificContext } = req.body;
    if (!message?.trim()) return res.status(400).json({ success: false, error: 'Message is required' });

    // Fetch student context: recent submissions, skills, feedback
    let studentContext = '';
    if (studentId) {
      const student = await prisma.user.findUnique({
        where: { id: studentId },
        select: { name: true, section: { select: { name: true } } }
      });

      const recentSubs = await prisma.submission.findMany({
        where: { studentId, status: 'GRADED' },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        include: { activity: { select: { title: true, type: true, class: { select: { name: true, gradeLevel: true } } } } }
      });

      if (student) {
        // PII POLICY: Do NOT send student name to AI. Use anonymous identifier.
        studentContext += `\nSTUDENT PROFILE:\n- Student ID: ${studentId.substring(0, 8)}\n- Section: ${student.section?.name || 'Unknown'}\n`;
      }

      if (recentSubs.length > 0) {
        const gradeLevel = recentSubs[0]?.activity?.class?.gradeLevel || 'Grade 6';
        studentContext += `- Grade Level: ${gradeLevel}\n`;
        studentContext += `\nRECENT GRADES (most recent first):\n`;
        for (const sub of recentSubs) {
          const score = sub.hitlScore ?? sub.aiScore ?? 0;
          let feedbackSummary = '';
          try {
            const fb = JSON.parse(sub.hitlFeedback || sub.aiFeedback || '{}');
            feedbackSummary = fb.strengths || fb.areasForGrowth?.[0]?.explanation || '';
          } catch {
            feedbackSummary = (sub.hitlFeedback || sub.aiFeedback || '').slice(0, 100);
          }
          studentContext += `  - "${sub.activity?.title}" (${sub.activity?.class?.name}): Score ${score}/100. Feedback: "${feedbackSummary.slice(0, 120)}"\n`;

          // Include skill scores if available
          if (sub.skillScores) {
            try {
              const skills = JSON.parse(sub.skillScores);
              studentContext += `    Skills: Vocabulary ${skills.vocabulary}/25, Punctuation ${skills.punctuation}/25, Thematic Flow ${skills.thematicFlow}/25, Sentence Structure ${skills.sentenceStructure}/25\n`;
            } catch {}
          }
        }
      }
    }

    if (specificContext) {
      studentContext += `\nCURRENT CONTEXT THE STUDENT IS ASKING ABOUT:\n${JSON.stringify(specificContext, null, 2)}\n`;
    }

    // Build the conversation for Gemini
    const systemPrompt = `You are "Study Buddy," an encouraging, localized Socratic tutor for a student in a Philippine public school. You speak warmly, like a supportive Ate or Kuya.

YOUR ABSOLUTE RULES:
1. You are STRICTLY FORBIDDEN from writing essays, answers, paragraphs, or any homework content for the student. NEVER do the student's work.
2. If the student asks you to write something for them, kindly refuse and instead ask a guiding question.
3. Use the Socratic method: ask leading questions to help the student discover the answer themselves.
4. Celebrate effort and progress — even small wins.
5. Keep responses SHORT (2-4 sentences max). Students lose attention with long messages.
6. If the student asks about their grades or feedback, reference their ACTUAL data below — do not make up scores.
7. You may use simple Filipino/Taglish phrases naturally (e.g., "Magaling!", "Kaya mo 'yan!") to feel more relatable.
8. If the student seems frustrated, validate their feelings first, then gently guide them.

${studentContext}

Remember: You are a tutor, not a homework machine. Guide, don't give answers.`;

    // Build conversation history for multi-turn chat
    const contents = [];

    // Add system instruction as the first user turn
    contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
    contents.push({ role: 'model', parts: [{ text: "Understood! I'm Study Buddy — I'll guide and encourage, never give answers directly. How can I help you today? 😊" }] });

    // Add previous conversation turns
    for (const turn of conversationHistory.slice(-10)) { // Limit to last 10 turns
      contents.push({
        role: turn.role === 'user' ? 'user' : 'model',
        parts: [{ text: turn.text }]
      });
    }

    // Add the current message
    contents.push({ role: 'user', parts: [{ text: message }] });

    let reply = "I'm having a little trouble right now. Can you try asking again? 😊";
    try {
      const result = await chatModel.generateContent({ contents });
      reply = result.response.text().trim();
    } catch (e) {
      console.log('⚠ Student chat AI error:', e.message?.slice(0, 100));
      // Try with a simpler single-turn call
      try {
        const fallbackPrompt = `${systemPrompt}\n\nStudent says: "${message}"\n\nRespond as Study Buddy (2-4 sentences, encouraging, Socratic):`;
        const result = await chatModel.generateContent(fallbackPrompt);
        reply = result.response.text().trim();
      } catch (e2) {
        console.log('⚠ Student chat fallback also failed:', e2.message?.slice(0, 80));
      }
    }

    res.json({ success: true, reply });
  } catch (e) {
    console.log('❌ Student chat error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// DEV SEED
// ─────────────────────────────────────────
app.post('/api/dev/seed', async (req, res) => {
  try {
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
    await prisma.gradingExample.deleteMany();
    await prisma.submission.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.class.deleteMany();
    await prisma.section.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');

    const teacher = await prisma.user.create({
      data: { name: 'Maria Clara', username: 'maria@school.edu.ph', email: 'maria@school.edu.ph', password: 'password', role: 'TEACHER', schoolName: 'Manila Science HS' }
    });
    const section = await prisma.section.create({ data: { name: 'Grade 10 - Rizal', teacherId: teacher.id } });
    const student = await prisma.user.create({
      data: { name: 'Juan Dela Cruz', username: 'RIZAL-001', password: 'password123', role: 'STUDENT', sectionId: section.id }
    });
    const student2 = await prisma.user.create({
      data: { name: 'Maria Santos', username: 'RIZAL-002', password: 'password123', role: 'STUDENT', sectionId: section.id }
    });
    const class1 = await prisma.class.create({
      data: { name: 'Filipino 10', gradeLevel: 'Grade 10', subject: 'Filipino', schoolYear: '2024-2025', teacherId: teacher.id, sectionId: section.id }
    });
    const activity = await prisma.activity.create({
      data: { title: 'Noli Me Tangere Reflection', type: 'Essay', points: 100, classId: class1.id, instructions: 'Write a 2-paragraph reflection on the novel.', submissionMode: 'TEACHER_UPLOAD' }
    });
    const activity2 = await prisma.activity.create({
      data: { title: 'El Filibusterismo Journal', type: 'Journal', points: 100, classId: class1.id, instructions: 'Journal your thoughts on the second novel.', submissionMode: 'STUDENT_SUBMIT', deadline: '2025-06-30' }
    });
    // Seed with multiple submissions to trigger Early Warning detection
    const skillSets = [
      { vocabulary: 22, punctuation: 20, thematicFlow: 21, sentenceStructure: 20 }, // submission 1 — good
      { vocabulary: 19, punctuation: 17, thematicFlow: 18, sentenceStructure: 16 }, // submission 2 — dropping
      { vocabulary: 15, punctuation: 13, thematicFlow: 14, sentenceStructure: 12 }, // submission 3 — warning!
    ];
    for (let i = 0; i < skillSets.length; i++) {
      await prisma.submission.create({
        data: {
          studentId: student.id, activityId: activity.id,
          aiScore: 80 - i * 8, hitlScore: 82 - i * 8,
          aiFeedback: JSON.stringify({
            strengths: `Submission ${i + 1} AI feedback. You did well on this part.`,
            areasForGrowth: [{ studentQuote: "An example mistake from the essay.", explanation: "This needs improvement." }],
            actionableSteps: ["Review your vocabulary.", "Check your punctuation."],
            skillExplanations: { vocabulary: "Good words.", punctuation: "Some errors.", thematicFlow: "Okay.", sentenceStructure: "Good." }
          }),
          hitlFeedback: JSON.stringify({
            strengths: `Submission ${i + 1} teacher feedback. Great job!`,
            areasForGrowth: [{ studentQuote: "An example mistake from the essay.", explanation: "This needs improvement." }],
            actionableSteps: ["Review your vocabulary.", "Check your punctuation."],
            skillExplanations: { vocabulary: "Good words.", punctuation: "Some errors.", thematicFlow: "Okay.", sentenceStructure: "Good." }
          }),
          readingStrategy: 'Focus on signpost words.',
          rubricData: JSON.stringify({ content: { score: 35 - i * 3, max: 40 }, organization: { score: 25 - i * 2, max: 30 }, grammar: { score: 22 - i * 3, max: 30 } }),
          skillScores: JSON.stringify(skillSets[i]),
          status: 'GRADED'
        }
      });
    }
    // Seed a Mini-RAG grading example
    await prisma.gradingExample.create({
      data: { teacherId: teacher.id, activityType: 'Essay', gradeLevel: 'Grade 10', aiFeedback: 'Good effort.', teacherFeedback: 'Napakagaling mo! Keep developing your paragraph transitions — you are nearly there!', aiScore: 78, teacherScore: 85 }
    });

    res.json({ success: true, message: 'Seeded! Teacher: maria@school.edu.ph / password | Students: RIZAL-001, RIZAL-002 / password123' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────
// DEPED TOPICS ENDPOINT
// ─────────────────────────────────────────
app.get('/api/topics', (req, res) => {
  const topics = getAllTopics();
  res.json({ success: true, topics });
});

// ─────────────────────────────────────────
// STUDENT ANALYTICS (Topic-based performance)
// ─────────────────────────────────────────
app.get('/api/student/:studentId/analytics', async (req, res) => {
  try {
    const { studentId } = req.params;
    const submissions = await prisma.submission.findMany({
      where: { studentId, status: 'GRADED', archivedAt: null },
      include: {
        activity: { select: { title: true, type: true, topic: true, points: true, class: { select: { name: true } } } }
      },
      orderBy: { createdAt: 'asc' }
    });

    // Topic mastery: group by activity topic, compute avg percentage
    const topicMap = {};
    for (const sub of submissions) {
      const topic = sub.activity?.topic || sub.activity?.title;
      if (!topic) continue;
      if (!topicMap[topic]) topicMap[topic] = { scores: [], points: [] };
      topicMap[topic].scores.push(sub.hitlScore ?? sub.aiScore ?? 0);
      topicMap[topic].points.push(sub.activity?.points || 100);
    }

    const topicMastery = Object.entries(topicMap).map(([topicId, data]) => {
      const avgScore = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
      const avgPoints = data.points.reduce((a, b) => a + b, 0) / data.points.length;
      const avgPercentage = Math.round((avgScore / avgPoints) * 100);
      const topicInfo = getTopicById(topicId);
      return {
        topicId,
        topicName: topicInfo?.name || topicId,
        quarter: topicInfo?.quarter || null,
        avgScore: Math.round(avgScore),
        avgPercentage,
        count: data.scores.length
      };
    }).sort((a, b) => (b.avgPercentage - a.avgPercentage));

    // Skill trend: last 10 graded submissions with skillScores
    const SKILLS = ['vocabulary', 'punctuation', 'thematicFlow', 'sentenceStructure'];
    const skillTrend = submissions
      .filter(s => s.skillScores)
      .slice(-10)
      .map(s => {
        try {
          const skills = JSON.parse(s.skillScores);
          return {
            activityTitle: s.activity?.title || '',
            date: s.createdAt,
            ...skills
          };
        } catch { return null; }
      }).filter(Boolean);

    // Strongest / weakest topic
    const strongestTopic = topicMastery.length > 0 ? topicMastery[0].topicName : null;
    const weakestTopic = topicMastery.length > 0 ? topicMastery[topicMastery.length - 1].topicName : null;

    // Skill averages
    const avgSkills = {};
    SKILLS.forEach(skill => {
      const vals = skillTrend.map(h => h[skill] || 0).filter(v => v > 0);
      avgSkills[skill] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    });

    res.json({
      success: true,
      topicMastery,
      skillTrends: skillTrend,
      strongestTopic,
      weakestTopic,
      avgSkills,
      totalGraded: submissions.length
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// GRADE EXPORT (CSV + XLSX)
// ─────────────────────────────────────────
app.get('/api/teacher/:teacherId/gradebook/export', async (req, res) => {
  try {
    const { classId, sectionId, format = 'csv' } = req.query;
    const teacherId = req.params.teacherId;

    // Determine which classes to export
    let classIds = [];
    if (classId) {
      classIds = [classId];
    } else if (sectionId) {
      const sectionClasses = await prisma.class.findMany({
        where: { teacherId, sectionId },
        select: { id: true }
      });
      classIds = sectionClasses.map(c => c.id);
    } else {
      return res.status(400).json({ success: false, error: 'classId or sectionId required' });
    }

    // Build grade data for each class
    const classData = [];
    for (const cId of classIds) {
      const cls = await prisma.class.findUnique({
        where: { id: cId },
        include: {
          section: { include: { students: { select: { id: true, name: true, username: true }, orderBy: { name: 'asc' } } } },
          activities: {
            include: { submissions: { select: { studentId: true, aiScore: true, hitlScore: true, status: true, archivedAt: true } } },
            orderBy: { createdAt: 'asc' }
          }
        }
      });
      if (!cls) continue;

      const students = cls.section?.students || [];
      const activities = cls.activities || [];

      // Build student rows
      const rows = students.map(student => {
        const row = { name: student.name, username: student.username };
        let totalScore = 0, totalPoints = 0, gradedCount = 0;
        for (const act of activities) {
          const sub = act.submissions.find(s => s.studentId === student.id && !s.archivedAt);
          const score = sub ? (sub.hitlScore ?? sub.aiScore ?? null) : null;
          row[act.id] = score;
          if (score !== null) {
            totalScore += score;
            totalPoints += act.points || 100;
            gradedCount++;
          }
        }
        row.average = gradedCount > 0 ? Math.round((totalScore / totalPoints) * 100) : null;
        return row;
      });

      classData.push({ cls, activities, students, rows });
    }

    if (format === 'xlsx') {
      // Excel export using exceljs
      let ExcelJS;
      try {
        ExcelJS = require('exceljs');
      } catch {
        return res.status(500).json({ success: false, error: 'exceljs not installed. Run: npm install exceljs' });
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'TulongGuro';
      workbook.created = new Date();

      for (const { cls, activities, rows } of classData) {
        const sheetName = (cls.name || 'Grades').substring(0, 31);
        const sheet = workbook.addWorksheet(sheetName);

        // Metadata rows
        sheet.addRow(['Class:', cls.name]);
        sheet.addRow(['Section:', cls.section?.name || 'N/A']);
        sheet.addRow(['School Year:', cls.schoolYear]);
        sheet.addRow(['Exported:', new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })]);
        sheet.addRow([]);

        // Header row
        const headers = ['Student Name', ...activities.map(a => a.title), 'Average (%)'];
        const headerRow = sheet.addRow(headers);
        headerRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B21A8' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = { bottom: { style: 'thin', color: { argb: 'FF9333EA' } } };
        });

        // Data rows
        for (const row of rows) {
          const dataRow = sheet.addRow([
            row.name,
            ...activities.map(a => row[a.id] !== null ? row[a.id] : '—'),
            row.average !== null ? `${row.average}%` : '—'
          ]);
          // Color code scores
          dataRow.eachCell((cell, colNumber) => {
            if (colNumber > 1) {
              const val = typeof cell.value === 'number' ? cell.value : parseInt(String(cell.value));
              if (!isNaN(val)) {
                if (val >= 85) cell.font = { color: { argb: 'FF16A34A' }, bold: true };
                else if (val >= 75) cell.font = { color: { argb: 'FFD97706' } };
                else cell.font = { color: { argb: 'FFDC2626' } };
              }
              cell.alignment = { horizontal: 'center' };
            }
          });
        }

        // Class average row
        const avgRow = ['CLASS AVERAGE'];
        for (const act of activities) {
          const scores = rows.map(r => r[act.id]).filter(s => s !== null);
          avgRow.push(scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : '—');
        }
        const allAvgs = rows.map(r => r.average).filter(a => a !== null);
        avgRow.push(allAvgs.length > 0 ? `${Math.round(allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length)}%` : '—');
        const footerRow = sheet.addRow(avgRow);
        footerRow.eachCell(cell => {
          cell.font = { bold: true, size: 11 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
          cell.alignment = { horizontal: 'center' };
        });

        // Auto-fit columns
        sheet.columns.forEach(col => {
          let maxLen = 10;
          col.eachCell({ includeEmpty: true }, cell => {
            const len = cell.value ? String(cell.value).length : 0;
            if (len > maxLen) maxLen = len;
          });
          col.width = Math.min(maxLen + 4, 40);
        });
      }

      const fileName = classData.length === 1
        ? `${classData[0].cls.name.replace(/[^a-zA-Z0-9]/g, '_')}_Grades.xlsx`
        : `Section_Grades_Export.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      await workbook.xlsx.write(res);
      res.end();

    } else {
      // CSV export
      const lines = [];
      for (const { cls, activities, rows } of classData) {
        lines.push(`# Class: ${cls.name}`);
        lines.push(`# Section: ${cls.section?.name || 'N/A'}`);
        lines.push(`# School Year: ${cls.schoolYear}`);
        lines.push(`# Exported: ${new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })}`);
        lines.push('');

        // Header
        const headers = ['Student Name', ...activities.map(a => `"${a.title.replace(/"/g, '""')}"`), 'Average (%)'];
        lines.push(headers.join(','));

        // Data rows
        for (const row of rows) {
          const vals = [
            `"${row.name.replace(/"/g, '""')}"`,
            ...activities.map(a => row[a.id] !== null ? row[a.id] : ''),
            row.average !== null ? `${row.average}%` : ''
          ];
          lines.push(vals.join(','));
        }

        // Class average
        const avgVals = ['CLASS AVERAGE'];
        for (const act of activities) {
          const scores = rows.map(r => r[act.id]).filter(s => s !== null);
          avgVals.push(scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : '');
        }
        const allAvgs = rows.map(r => r.average).filter(a => a !== null);
        avgVals.push(allAvgs.length > 0 ? `${Math.round(allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length)}%` : '');
        lines.push(avgVals.join(','));
        lines.push('');
      }

      const fileName = classData.length === 1
        ? `${classData[0].cls.name.replace(/[^a-zA-Z0-9]/g, '_')}_Grades.csv`
        : `Section_Grades_Export.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(lines.join('\n'));
    }
  } catch (e) {
    console.error('Export error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// GRADE RETENTION — Admin Report
// Retention policy: grades are retained for at least 1 year after school year end.
// This endpoint lists submissions grouped by retention status.
// No auto-deletion — admin reviews and decides.
// ─────────────────────────────────────────
app.get('/api/admin/retention-report', async (req, res) => {
  try {
    const now = new Date();
    const submissions = await prisma.submission.findMany({
      where: { retainUntil: { not: null } },
      select: {
        id: true,
        status: true,
        retainUntil: true,
        archivedAt: true,
        createdAt: true,
        activity: { select: { title: true, class: { select: { name: true, schoolYear: true } } } },
        student: { select: { name: true } }
      },
      orderBy: { retainUntil: 'asc' }
    });

    const active = submissions.filter(s => !s.archivedAt && s.retainUntil > now);
    const pastRetention = submissions.filter(s => !s.archivedAt && s.retainUntil <= now);
    const archived = submissions.filter(s => s.archivedAt);

    // Group by school year
    const bySchoolYear = {};
    for (const sub of submissions) {
      const sy = sub.activity?.class?.schoolYear || 'Unknown';
      if (!bySchoolYear[sy]) bySchoolYear[sy] = { total: 0, active: 0, pastRetention: 0, archived: 0 };
      bySchoolYear[sy].total++;
      if (sub.archivedAt) bySchoolYear[sy].archived++;
      else if (sub.retainUntil <= now) bySchoolYear[sy].pastRetention++;
      else bySchoolYear[sy].active++;
    }

    res.json({
      success: true,
      summary: {
        totalSubmissions: submissions.length,
        activeRetention: active.length,
        pastRetention: pastRetention.length,
        archived: archived.length
      },
      bySchoolYear,
      pastRetentionSubmissions: pastRetention.slice(0, 50) // Limit response size
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(port, () => console.log(`TulongGuro API running on port ${port}`));
