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
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
const modelLite = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// ─────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, schoolName } = req.body;
    const user = await prisma.user.create({
      data: { name, email, username: email, password, role: 'TEACHER', schoolName }
    });
    res.json({ success: true, user });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const user = await prisma.user.findFirst({ where: { username, password, role } });
    if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });
    res.json({ success: true, user });
  } catch (e) {
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
      _count: { select: { activities: true } }
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
    const { title, type, points, classId, instructions, deadline, submissionMode, rubric } = req.body;
    const filePaths = (req.files || []).map(f => `/uploads/${f.filename}`);
    const activity = await prisma.activity.create({
      data: {
        title, type,
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

// AI Rubric Generation
app.post('/api/teacher/generate-rubric', async (req, res) => {
  try {
    const { instructions, activityType, points } = req.body;
    const prompt = `You are an educational rubric designer for Philippine schools (DepEd standards). Create a grading rubric for a ${activityType || 'essay'} activity worth ${points || 100} points.

Activity instructions: "${instructions || 'General essay activity'}"

Respond with JSON ONLY: {"criteria":[{"name":"string","description":"string","points":number}]}
Create 3-5 criteria that sum to ${points || 100} points total. Make criteria relevant to the instructions.`;

    let criteria = [
      { name: 'Content & Ideas', description: 'Depth and relevance of ideas presented', points: 40 },
      { name: 'Organization', description: 'Logical flow and structure of the response', points: 30 },
      { name: 'Language & Grammar', description: 'Correct grammar, punctuation, and vocabulary', points: 30 }
    ];

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(text);
      criteria = parsed.criteria;
    } catch (e) {
      console.log('⚠ Primary rubric gen failed, trying lite:', e.message?.slice(0, 80));
      try {
        const result = await modelLite.generateContent(prompt);
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);
        criteria = parsed.criteria;
      } catch (e2) {
        console.log('⚠ Both rubric gen models failed:', e2.message?.slice(0, 80));
      }
    }
    res.json({ success: true, criteria });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
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

    const imageUrl = `/uploads/${imageFile.filename}`;

    // 1) Preprocess the image
    const processedPath = await preprocessImage(imageFile.path);
    const processedFilename = path.basename(processedPath);
    // Upload to Supabase Storage in production, local path in dev
    const processedUrl = await uploadToCloud(processedPath, processedFilename);

    // 2) Fetch activity rubric context
    let rubricContext = 'Use standard DepEd essay rubric: Content & Ideas (40 pts), Organization (30 pts), Language & Grammar (30 pts).';
    let activityContext = '';
    if (activityId && activityId !== 'mock-activity-id') {
      const activity = await prisma.activity.findUnique({ where: { id: activityId } });
      if (activity) {
        activityContext = `Activity: "${activity.title}" (${activity.type}). Instructions: "${activity.instructions || 'N/A'}".`;
        if (activity.rubric) {
          try {
            const parsed = JSON.parse(activity.rubric);
            if (parsed.criteria?.length) {
              rubricContext = 'Use this rubric: ' + parsed.criteria.map(c => `${c.name} (${c.points} pts): ${c.description || ''}`).join('; ') + '.';
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

    // 4) Build the prompt — includes no-text detection
    const prompt = `You are an expert essay grader for Philippine public schools (DepEd K-12 curriculum).

${activityContext}
${rubricContext}${fewShotExamples}

IMPORTANT RULES:
- First, check if the image contains readable handwritten or printed text. 
- If the image is BLANK, contains only drawings/art with no text, is too blurry to read, or has NO readable written content, you MUST set score to 0 and explain the issue in the feedback field (e.g. "No readable text was found in this image. The photo appears to be blank/a drawing/too blurry. Please re-upload a clearer photo of the student's written work.").
- If you CAN read text, grade it normally against the rubric.

TASK: In ONE step:
1. Grade the handwritten student essay against the rubric
2. Identify specific writing weaknesses
3. Generate a personalized reading intervention strategy

Respond with JSON ONLY (no markdown, no code fences). Use this exact schema:
{
  "score": <total 0-100, use 0 if no readable text>,
  "contentScore": <number>, "contentMax": <number>,
  "organizationScore": <number>, "organizationMax": <number>,
  "grammarScore": <number>, "grammarMax": <number>,
  "feedback": "<warm, constructive, 3 sentences max>",
  "readingStrategy": "<personalized 2-sentence reading strategy, or 'N/A' if no text found>",
  "noTextDetected": <true if image has no readable text, false otherwise>,
  "skillScores": {
    "vocabulary": <0-25>,
    "punctuation": <0-25>,
    "thematicFlow": <0-25>,
    "sentenceStructure": <0-25>
  }
}`;

    // Track AI source for transparency
    let aiSource = 'mock';  // 'gemini' | 'gemini-lite' | 'mock'
    let aiError = null;

    let aiResult = null;

    async function callGemini(m, parts) {
      const result = await m.generateContent(parts);
      const text = result.response.text();
      return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
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
          feedback: `⚠ AI grading is currently unavailable. Error: ${errMsg.slice(0, 120)}. The teacher will need to grade this manually.`,
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
- Feedback: "${aiResult.feedback}"

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

    const submission = await prisma.submission.create({
      data: {
        studentId: studentId || 'mock-student-id',
        activityId: activityId || 'mock-activity-id',
        imageUrl: processedUrl,
        aiScore: aiResult.score,
        hitlScore: aiResult.score,
        aiFeedback: aiResult.feedback,
        readingStrategy: aiResult.readingStrategy,
        rubricData: JSON.stringify({
          content: { score: aiResult.contentScore, max: aiResult.contentMax },
          organization: { score: aiResult.organizationScore, max: aiResult.organizationMax },
          grammar: { score: aiResult.grammarScore, max: aiResult.grammarMax }
        }),
        skillScores: aiResult.skillScores ? JSON.stringify(aiResult.skillScores) : null,
        covData: covData ? JSON.stringify(covData) : null,
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
      noTextDetected: aiResult.noTextDetected || false
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
      const result = await model.generateContent(sys);
      refinedFeedback = result.response.text().trim();
    } catch (e) {
      console.log('⚠ AI refine primary model failed, trying lite:', e.message?.slice(0, 80));
      try {
        const result = await modelLite.generateContent(sys);
        refinedFeedback = result.response.text().trim();
      } catch (e2) {
        console.log('⚠ AI refine both models failed:', e2.message?.slice(0, 80));
      }
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
    const { classId } = req.query;
    // Get all classes for this teacher
    const classes = await prisma.class.findMany({
      where: classId ? { id: classId, teacherId: req.params.teacherId } : { teacherId: req.params.teacherId },
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

    res.json({ success: true, warnings, studentTrends, classAvgSkills, warningCount: warnings.length });
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
      include: { section: true }
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
    res.json({ success: true, student, submissions, avgGrade, stars });
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
          aiFeedback: `Submission ${i + 1} AI feedback.`,
          hitlFeedback: `Submission ${i + 1} teacher feedback.`,
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

app.listen(port, () => console.log(`TulongGuro API running on port ${port}`));
