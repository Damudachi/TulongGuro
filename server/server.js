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
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { getAllTopics, getTopicById, getTopicAIGuidance } = require('./depedTopics');
const { getAllRubricTemplates, getRubricTemplateById } = require('./rubricTemplates');
const { SKILLS, classifyCriterion } = require('./skillTaxonomy');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const prisma = new PrismaClient();
const port = process.env.PORT || 3000;

const BCRYPT_SALT_ROUNDS = 10;

const aiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const aiConfigured = Boolean(aiApiKey && aiApiKey !== 'mock' && aiApiKey !== 'YOUR_API_KEY');

app.use(cors());
app.use(express.json());

// File storage: Supabase Storage in production, local disk in development
const STORAGE_BUCKET = process.env.SUPABASE_BUCKET || 'uploads';
const useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
let supabase = null;
if (useSupabase) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  console.log('☁ Using Supabase Storage for file uploads');
} else {
  console.log('📁 Using local disk for file uploads (set SUPABASE_URL/KEY for cloud)');
  // Most hosts (Render, Fly, Heroku, containers) give each instance a fresh
  // filesystem, so anything written here disappears on the next deploy or
  // restart — submitted photos then 404 for everyone. Loud on purpose.
  console.warn(
    '\n⚠  UPLOADS ARE NOT DURABLE\n' +
    '   Submitted photos are being written to this server\'s local disk.\n' +
    '   On a hosted deployment that disk is wiped on every restart/redeploy,\n' +
    '   which makes previously uploaded work show as a broken image.\n' +
    '   Fix: set SUPABASE_URL and SUPABASE_KEY, and create a PUBLIC storage\n' +
    '   bucket named "uploads" in your Supabase project.\n'
  );
}

/**
 * Confirm at boot that the bucket is actually usable, rather than finding out
 * one upload at a time. A wrong key or a missing bucket is a deploy-time
 * mistake, and it should read like one in the logs.
 */
async function verifyStorage() {
  if (!useSupabase) return;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).list('', { limit: 1 });
  if (!error) {
    console.log(`☁ Storage bucket "${STORAGE_BUCKET}" is reachable`);
    return;
  }
  console.error(
    `\n⚠  STORAGE BUCKET "${STORAGE_BUCKET}" IS NOT USABLE — ${error.message}\n` +
    '   Uploads will fail until this is fixed. Check that:\n' +
    `   • a PUBLIC bucket named "${STORAGE_BUCKET}" exists in this project, and\n` +
    '   • SUPABASE_KEY is the service_role key (the anon key cannot write).\n'
  );
}

// Local uploads dir (used in dev or as temp staging for sharp)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));

/**
 * Make a phone-camera filename safe to use as both a URL path segment and a
 * Supabase Storage object key. Names like "Screenshot 2026-05-07 19:55.png"
 * arrive routinely; spaces survive in an <img src> but colons, #, ? and
 * non-ASCII do not, and Supabase rejects several of them outright.
 */
function safeUploadName(originalname) {
  const ext = (path.extname(originalname || '') || '.jpg').toLowerCase().replace(/[^a-z0-9.]/g, '');
  const base = path.basename(originalname || 'upload', path.extname(originalname || ''))
    .normalize('NFKD').replace(/[^\w-]+/g, '-')   // collapse spaces/punctuation/accents
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${Date.now()}-${base || 'upload'}${ext || '.jpg'}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, safeUploadName(file.originalname))
});
const upload = multer({ storage });

/**
 * Persist a local file and return the URL to store in the database. Every
 * persisted file reference — submissions, school logos, curriculum files,
 * activity attachments — goes through here.
 *
 * With Supabase configured this throws rather than falling back to local disk
 * when the upload fails. The fallback used to look like resilience, but the
 * local path it returned was written to the database and the file behind it
 * vanished on the next redeploy — so a storage misconfiguration surfaced days
 * later as an unexplained broken image instead of at the moment of upload.
 * Failing here means the student sees "upload failed" and can retry.
 */
async function uploadToCloud(localPath, filename, { folder = 'submissions', contentType = 'image/jpeg' } = {}) {
  if (!useSupabase) return `/uploads/${filename}`;
  const buffer = fs.readFileSync(localPath);
  const remotePath = `${folder}/${filename}`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(remotePath, buffer, { contentType, upsert: true });
  if (error) {
    console.error(`⚠ Supabase upload failed for ${remotePath}:`, error.message);
    throw new Error(`Could not save the file to storage: ${error.message}`);
  }
  const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(remotePath);
  // Clean up local temp file in production
  if (process.env.NODE_ENV === 'production') {
    try { fs.unlinkSync(localPath); } catch {}
  }
  return urlData.publicUrl;
}

// Helper: resolve a stored imageUrl (either a local /uploads/... path or a
// Supabase Storage public URL) to a local file path readable by fs/sharp —
// needed because AI grading always reads the image off disk. Remote images
// are downloaded to a temp file; callers must clean it up via the returned
// isTemp flag so we don't delete the one true copy of a local-only file.
async function resolveLocalImagePath(imageUrl) {
  if (/^https?:\/\//i.test(imageUrl)) {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to download image from storage: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const tempPath = path.join(uploadsDir, `tmp-${Date.now()}-${path.basename(new URL(imageUrl).pathname)}`);
    fs.writeFileSync(tempPath, buffer);
    return { path: tempPath, isTemp: true };
  }
  return { path: path.join(__dirname, imageUrl), isTemp: false };
}

const genAI = aiConfigured ? new GoogleGenerativeAI(aiApiKey) : null;
const model = genAI ? genAI.getGenerativeModel({
  model: 'gemini-3.5-flash',
  generationConfig: { responseMimeType: 'application/json' }
}) : null;
// A separate, smaller model in the same family — used as a fallback when the
// primary model above is persistently unavailable (e.g. "high demand" 503s),
// since it runs on different capacity and is far less likely to be saturated
// at the same time.
const modelLite = genAI ? genAI.getGenerativeModel({
  model: 'gemini-3.5-flash-lite',
  generationConfig: { responseMimeType: 'application/json' }
}) : null;
const chatModel = genAI ? genAI.getGenerativeModel({ model: 'gemini-3.5-flash' }) : null;

if (aiConfigured) {
  console.log('🤖 Gemini AI enabled');
} else {
  console.log('⚠ Gemini AI disabled: set GEMINI_API_KEY or GOOGLE_API_KEY in server/.env to enable AI features');
}

// Wraps a Gemini generateContent() call with retry + backoff for transient
// upstream failures (503 "high demand", 429 rate limits, etc.) so a momentary
// blip on Google's side doesn't surface as a hard failure to the user.
async function generateContentWithRetry(genModel, parts, { retries = 2, baseDelayMs = 800 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await genModel.generateContent(parts);
    } catch (err) {
      lastErr = err;
      const retryable = /503|overloaded|high demand|unavailable|429|rate limit|resource.?exhausted/i.test(err.message || '');
      if (attempt < retries && retryable) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`⚠ Gemini call failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms: ${(err.message || '').slice(0, 120)}`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        break;
      }
    }
  }
  throw lastErr;
}

// Same as generateContentWithRetry, but if the primary model still fails after
// exhausting its retries (e.g. a sustained outage, not just a momentary blip),
// falls back once to modelLite before giving up.
async function generateContentWithFallback(primaryModel, parts, opts = {}) {
  try {
    return await generateContentWithRetry(primaryModel, parts, opts);
  } catch (err) {
    const retryable = /503|overloaded|high demand|unavailable|429|rate limit|resource.?exhausted/i.test(err.message || '');
    if (retryable && modelLite && primaryModel !== modelLite) {
      console.log(`⚠ Primary model still failing after retries, falling back to modelLite: ${(err.message || '').slice(0, 120)}`);
      return await generateContentWithRetry(modelLite, parts, { retries: 1, baseDelayMs: opts.baseDelayMs || 800 });
    }
    throw err;
  }
}

// ─────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────
// Public sign-up now registers a SCHOOL and its first ADMIN. Teacher accounts
// are created by that admin (see /api/admin/:adminId/teachers) and student
// accounts by teachers (see /api/teacher/sections) — neither can self-register.
// Accepts JSON, or multipart/form-data when the admin attaches a school logo.
app.post('/api/auth/register', (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    upload.single('logo')(req, res, next);
  } else {
    next();
  }
}, async (req, res) => {
  try {
    const { name, email, password, schoolName, brandColor } = req.body;
    if (!name || !email || !password || !schoolName) {
      return res.status(400).json({ success: false, error: 'Name, email, password and school name are all required.' });
    }
    // Branding is optional; reject only a malformed colour rather than silently
    // storing something the UI can't render.
    if (brandColor && !/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
      return res.status(400).json({ success: false, error: 'School colour must be a hex value like #1E3A8A.' });
    }

    const existing = await prisma.user.findFirst({ where: { email } });
    if (existing) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists. Please log in instead.' });
    }

    const trimmedSchool = schoolName.trim();
    const existingSchool = await prisma.school.findUnique({ where: { name: trimmedSchool } });
    if (existingSchool) {
      return res.status(400).json({
        success: false,
        error: `"${trimmedSchool}" is already registered. Ask your school's admin to create a teacher account for you.`
      });
    }

    const logoUrl = req.file
      ? await uploadToCloud(req.file.path, req.file.filename, { folder: 'school-logos', contentType: req.file.mimetype })
      : null;

    const school = await prisma.school.create({
      data: { name: trimmedSchool, logoUrl, brandColor: brandColor || null }
    });
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        name, email, username: email, password: hashedPassword,
        role: 'ADMIN', schoolName: trimmedSchool, schoolId: school.id
      }
    });

    const { password: _pw, ...safeAdmin } = user;
    return res.json({ success: true, user: safeAdmin, school });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

/** Seeds the demo sandbox class the teacher walkthrough refers to. */
async function seedDemoSandbox(user) {
    try {
      // schoolId is deliberately left null: the sandbox is personal scratch
      // space, so it stays out of the school-wide section list colleagues see.
      const demoSection = await prisma.section.create({
        data: { name: 'Grade 6 - Demo Section', gradeLevel: 'Grade 6', teacherId: user.id }
      });
      const demoStudentPassword = await bcrypt.hash('password', BCRYPT_SALT_ROUNDS);
      const demoStudent = await prisma.user.create({
        data: { name: 'Demo Student', username: `DEMO-${Date.now()}`, password: demoStudentPassword, role: 'STUDENT', sectionId: demoSection.id }
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
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    // Include related section data so clients receive up-to-date section info on login
    const user = await prisma.user.findFirst({
      where: { username, role },
      include: { section: true, school: true }
    });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

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

    const { password: _pw, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Storage health — answers "why are images broken?" without shell access.
 * Reports where uploads go and how many stored images are actually reachable.
 */
app.get('/api/health/storage', async (req, res) => {
  try {
    const subs = await prisma.submission.findMany({
      where: { imageUrl: { not: null } },
      select: { imageUrl: true }
    });

    let remote = 0, onDisk = 0, missing = 0, frontendAsset = 0;
    const missingSamples = [];
    for (const s of subs) {
      const url = s.imageUrl;
      if (/^https?:\/\//i.test(url)) { remote++; continue; }
      if (!url.startsWith('/uploads/')) { frontendAsset++; continue; }
      const abs = path.join(__dirname, url.replace(/^\//, ''));
      if (fs.existsSync(abs)) onDisk++;
      else { missing++; if (missingSamples.length < 5) missingSamples.push(url); }
    }

    // Prove the bucket is actually writable-adjacent (reachable + named right),
    // so this endpoint distinguishes "not configured" from "configured wrong".
    let bucket = null;
    if (useSupabase) {
      const { error } = await supabase.storage.from(STORAGE_BUCKET).list('', { limit: 1 });
      bucket = { name: STORAGE_BUCKET, reachable: !error, error: error?.message || null };
    }

    res.json({
      success: true,
      driver: useSupabase ? 'supabase-storage' : 'local-disk',
      durable: useSupabase,
      bucket,
      totalWithImage: subs.length,
      remote,
      onDisk,
      missing,
      frontendAsset,
      missingSamples,
      advice: useSupabase
        ? null
        : 'Uploads are on local disk and will be lost on restart. Set SUPABASE_URL and SUPABASE_KEY, then create a public "uploads" bucket.'
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * The school a user belongs to, for the header badge on every dashboard.
 * Admins and teachers carry schoolId directly; students inherit it from their
 * section, so resolve through that when their own is unset.
 */
app.get('/api/users/:userId/school', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
      include: { school: true, section: { include: { school: true } } }
    });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const school = user.school || user.section?.school || null;
    res.json({
      success: true,
      // schoolName is the pre-tenancy fallback for accounts not yet migrated.
      school: school || (user.schoolName ? { id: null, name: user.schoolName } : null)
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// ADMIN — school-level administration
// ─────────────────────────────────────────

/** Resolves an admin's school, or throws so the caller can 403. */
async function requireAdminSchool(adminId) {
  const admin = await prisma.user.findUnique({ where: { id: adminId }, include: { school: true } });
  if (!admin || admin.role !== 'ADMIN' || !admin.schoolId) {
    const err = new Error('Not authorized — an admin account is required.');
    err.status = 403;
    throw err;
  }
  return admin;
}

function sendAdminError(res, e) {
  res.status(e.status || 500).json({ success: false, error: e.message });
}

/** School overview: teachers, sections, curriculums and rubric counts. */
app.get('/api/admin/:adminId/overview', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const [teachers, sections, curriculums, rubricCount] = await Promise.all([
      prisma.user.findMany({
        where: { schoolId: admin.schoolId, role: 'TEACHER' },
        select: { id: true, name: true, email: true, username: true, createdAt: true, _count: { select: { taughtClasses: true, ownedSections: true } } },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.section.findMany({
        where: { schoolId: admin.schoolId },
        select: { id: true, name: true, gradeLevel: true, teacher: { select: { name: true } }, _count: { select: { students: true } } },
        orderBy: [{ gradeLevel: 'asc' }, { name: 'asc' }]
      }),
      prisma.curriculum.findMany({
        where: { schoolId: admin.schoolId },
        include: { _count: { select: { lessons: true } } },
        orderBy: [{ gradeLevel: 'asc' }, { subject: 'asc' }]
      }),
      prisma.rubricTemplate.count({ where: { schoolId: admin.schoolId } })
    ]);
    res.json({ success: true, school: admin.school, teachers, sections, curriculums, rubricCount });
  } catch (e) { sendAdminError(res, e); }
});

/** Create a teacher account inside the admin's school. */
app.post('/api/admin/:adminId/teachers', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const { name, email, password } = req.body;
    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ success: false, error: 'Name, email and a temporary password are required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const clash = await prisma.user.findFirst({ where: { OR: [{ email: normalizedEmail }, { username: normalizedEmail }] } });
    if (clash) return res.status(400).json({ success: false, error: 'An account with this email already exists.' });

    const teacher = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        username: normalizedEmail,
        password: await bcrypt.hash(password, BCRYPT_SALT_ROUNDS),
        role: 'TEACHER',
        schoolId: admin.schoolId,
        schoolName: admin.school?.name || admin.schoolName
      }
    });
    // Give them the same sandbox a self-registered teacher used to get, so the
    // onboarding walkthrough has something to point at.
    await seedDemoSandbox(teacher);

    const { password: _pw, ...safeTeacher } = teacher;
    res.json({ success: true, teacher: safeTeacher });
  } catch (e) { sendAdminError(res, e); }
});

/** Reset a teacher's password to a new temporary one. */
app.put('/api/admin/:adminId/teachers/:teacherId/password', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, error: 'A new password is required.' });
    const teacher = await prisma.user.findUnique({ where: { id: req.params.teacherId } });
    if (!teacher || teacher.schoolId !== admin.schoolId) {
      return res.status(404).json({ success: false, error: 'Teacher not found in your school.' });
    }
    await prisma.user.update({
      where: { id: teacher.id },
      data: { password: await bcrypt.hash(password, BCRYPT_SALT_ROUNDS) }
    });
    res.json({ success: true });
  } catch (e) { sendAdminError(res, e); }
});

/** Remove a teacher, but only while they still have no classes of their own. */
app.delete('/api/admin/:adminId/teachers/:teacherId', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const teacher = await prisma.user.findUnique({
      where: { id: req.params.teacherId },
      include: { _count: { select: { taughtClasses: true } } }
    });
    if (!teacher || teacher.schoolId !== admin.schoolId) {
      return res.status(404).json({ success: false, error: 'Teacher not found in your school.' });
    }
    // Real classes carry student submissions; only the seeded demo is disposable.
    const realClasses = await prisma.class.count({
      where: { teacherId: teacher.id, NOT: { name: { contains: '[DEMO]' } } }
    });
    if (realClasses > 0) {
      return res.status(400).json({ success: false, error: 'This teacher still has classes. Reassign or delete them first.' });
    }
    await prisma.rubricTemplate.deleteMany({ where: { teacherId: teacher.id } });
    await prisma.gradingExample.deleteMany({ where: { teacherId: teacher.id } });
    const demoClasses = await prisma.class.findMany({ where: { teacherId: teacher.id }, select: { id: true } });
    for (const cls of demoClasses) {
      await prisma.submission.deleteMany({ where: { activity: { classId: cls.id } } });
      await prisma.activity.deleteMany({ where: { classId: cls.id } });
      await prisma.classLesson.deleteMany({ where: { classId: cls.id } });
    }
    await prisma.class.deleteMany({ where: { teacherId: teacher.id } });
    const ownSections = await prisma.section.findMany({ where: { teacherId: teacher.id }, select: { id: true } });
    await prisma.user.deleteMany({ where: { sectionId: { in: ownSections.map(s => s.id) }, role: 'STUDENT' } });
    await prisma.section.deleteMany({ where: { teacherId: teacher.id } });
    await prisma.user.delete({ where: { id: teacher.id } });
    res.json({ success: true });
  } catch (e) { sendAdminError(res, e); }
});

/** Loads a teacher, asserting they belong to the admin's school. */
async function teacherInSchool(admin, teacherId) {
  const teacher = await prisma.user.findUnique({ where: { id: teacherId } });
  if (!teacher || teacher.schoolId !== admin.schoolId || teacher.role !== 'TEACHER') {
    const err = new Error('Teacher not found in your school.');
    err.status = 404;
    throw err;
  }
  return teacher;
}

/** Full profile for one teacher: their course shells and their sections. */
app.get('/api/admin/:adminId/teachers/:teacherId', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const teacher = await teacherInSchool(admin, req.params.teacherId);

    const [classes, sections, teachers] = await Promise.all([
      prisma.class.findMany({
        where: { teacherId: teacher.id },
        include: {
          section: { select: { id: true, name: true, gradeLevel: true, _count: { select: { students: true } } } },
          _count: { select: { activities: true, lessons: true } },
          activities: { select: { id: true, _count: { select: { submissions: true } } } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.section.findMany({
        where: { teacherId: teacher.id },
        include: {
          students: { select: { id: true, name: true, username: true }, orderBy: { username: 'asc' } },
          _count: { select: { classes: true } }
        },
        orderBy: [{ gradeLevel: 'asc' }, { name: 'asc' }]
      }),
      // Candidates for reassigning a course shell.
      prisma.user.findMany({
        where: { schoolId: admin.schoolId, role: 'TEACHER' },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' }
      })
    ]);

    const { password: _pw, ...safeTeacher } = teacher;
    res.json({
      success: true,
      teacher: safeTeacher,
      teachers,
      classes: classes.map(c => ({
        id: c.id, name: c.name, gradeLevel: c.gradeLevel, subject: c.subject, schoolYear: c.schoolYear,
        createdAt: c.createdAt,
        section: c.section,
        activityCount: c._count.activities,
        lessonCount: c._count.lessons,
        // Drives the "can this be deleted?" guard in the UI.
        submissionCount: c.activities.reduce((n, a) => n + a._count.submissions, 0)
      })),
      sections
    });
  } catch (e) { sendAdminError(res, e); }
});

/** Edit a teacher's name or email. */
app.put('/api/admin/:adminId/teachers/:teacherId', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const teacher = await teacherInSchool(admin, req.params.teacherId);
    const { name, email } = req.body;

    const data = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ success: false, error: 'Name cannot be empty.' });
      data.name = name.trim();
    }
    if (email !== undefined) {
      const normalized = email.trim().toLowerCase();
      if (!normalized) return res.status(400).json({ success: false, error: 'Email cannot be empty.' });
      const clash = await prisma.user.findFirst({
        where: { OR: [{ email: normalized }, { username: normalized }], NOT: { id: teacher.id } }
      });
      if (clash) return res.status(400).json({ success: false, error: 'Another account already uses this email.' });
      data.email = normalized;
      // username mirrors email for staff accounts — keep them in step or login breaks.
      data.username = normalized;
    }

    const updated = await prisma.user.update({ where: { id: teacher.id }, data });
    const { password: _pw, ...safeTeacher } = updated;
    res.json({ success: true, teacher: safeTeacher });
  } catch (e) { sendAdminError(res, e); }
});

/**
 * Reassign a course shell to a different teacher (and/or rename it).
 *
 * Everything a class owns — activities, lessons, and every submission with its
 * score and feedback — hangs off the Class row, so it all follows the shell
 * automatically. Only Class.teacherId changes; no student work is touched.
 */
app.put('/api/admin/:adminId/classes/:classId', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const cls = await prisma.class.findUnique({
      where: { id: req.params.classId },
      include: {
        teacher: true,
        activities: { select: { id: true, _count: { select: { submissions: true } } } }
      }
    });
    if (!cls || cls.teacher?.schoolId !== admin.schoolId) {
      return res.status(404).json({ success: false, error: 'Class not found in your school.' });
    }

    const { name, teacherId } = req.body;
    const data = {};

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ success: false, error: 'Class name cannot be empty.' });
      data.name = name.trim();
    }

    let previousTeacher = null;
    if (teacherId !== undefined && teacherId !== cls.teacherId) {
      const nextTeacher = await prisma.user.findUnique({ where: { id: teacherId } });
      if (!nextTeacher || nextTeacher.role !== 'TEACHER' || nextTeacher.schoolId !== admin.schoolId) {
        return res.status(400).json({ success: false, error: 'Choose a teacher from your own school.' });
      }
      // The new teacher must not already have an identical shell, or they'd end
      // up with two for the same section, subject and school year.
      const clash = await prisma.class.findFirst({
        where: {
          teacherId: nextTeacher.id,
          sectionId: cls.sectionId,
          schoolYear: cls.schoolYear,
          subject: cls.subject,
          gradeLevel: cls.gradeLevel,
          NOT: { id: cls.id }
        }
      });
      if (clash) {
        return res.status(400).json({
          success: false,
          error: `${nextTeacher.name} already has "${clash.name}" for this section, subject and school year.`
        });
      }
      previousTeacher = cls.teacher;
      data.teacherId = nextTeacher.id;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, error: 'Nothing to change.' });
    }

    const updated = await prisma.class.update({
      where: { id: cls.id },
      data,
      include: { teacher: { select: { id: true, name: true, email: true } } }
    });

    const submissionCount = cls.activities.reduce((n, a) => n + a._count.submissions, 0);
    const gradedCount = previousTeacher
      ? await prisma.submission.count({ where: { activity: { classId: cls.id }, status: 'GRADED' } })
      : 0;

    res.json({
      success: true,
      class: updated,
      // Reported back so the admin can see nothing was left behind.
      retained: previousTeacher
        ? { activities: cls.activities.length, submissions: submissionCount, graded: gradedCount }
        : null,
      previousTeacher: previousTeacher ? { id: previousTeacher.id, name: previousTeacher.name } : null
    });
  } catch (e) { sendAdminError(res, e); }
});

/** Delete a course shell. Refuses once students have submitted work to it. */
app.delete('/api/admin/:adminId/classes/:classId', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const cls = await prisma.class.findUnique({
      where: { id: req.params.classId },
      include: { teacher: true, activities: { select: { id: true, _count: { select: { submissions: true } } } } }
    });
    if (!cls || cls.teacher?.schoolId !== admin.schoolId) {
      return res.status(404).json({ success: false, error: 'Class not found in your school.' });
    }
    const submissions = cls.activities.reduce((n, a) => n + a._count.submissions, 0);
    if (submissions > 0) {
      return res.status(400).json({
        success: false,
        error: `This class has ${submissions} student submission(s). Delete those first if you really mean to remove it.`
      });
    }
    await prisma.activity.deleteMany({ where: { classId: cls.id } });
    await prisma.classLesson.deleteMany({ where: { classId: cls.id } });
    await prisma.class.delete({ where: { id: cls.id } });
    res.json({ success: true });
  } catch (e) { sendAdminError(res, e); }
});

/** Loads a section, asserting it belongs to the admin's school. */
async function sectionInSchool(admin, sectionId) {
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    include: { teacher: true }
  });
  const belongs = section && (section.schoolId === admin.schoolId || section.teacher?.schoolId === admin.schoolId);
  if (!belongs) {
    const err = new Error('Section not found in your school.');
    err.status = 404;
    throw err;
  }
  return section;
}

/** Everything about one section: roster, classes using it, and the adviser. */
app.get('/api/admin/:adminId/sections/:sectionId', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    await sectionInSchool(admin, req.params.sectionId);

    const [section, teachers] = await Promise.all([
      prisma.section.findUnique({
        where: { id: req.params.sectionId },
        include: {
          teacher: { select: { id: true, name: true, email: true } },
          students: {
            select: { id: true, name: true, username: true, _count: { select: { submissions: true } } },
            orderBy: { username: 'asc' }
          },
          classes: {
            select: {
              id: true, name: true, subject: true, gradeLevel: true, schoolYear: true,
              teacher: { select: { id: true, name: true } },
              _count: { select: { activities: true } }
            },
            orderBy: { createdAt: 'desc' }
          }
        }
      }),
      // Candidates for the adviser dropdown.
      prisma.user.findMany({
        where: { schoolId: admin.schoolId, role: 'TEACHER' },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' }
      })
    ]);

    res.json({ success: true, section, teachers });
  } catch (e) { sendAdminError(res, e); }
});

/** Rename a section, change its grade level, or reassign its adviser. */
app.put('/api/admin/:adminId/sections/:sectionId', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const section = await sectionInSchool(admin, req.params.sectionId);
    const { name, gradeLevel, teacherId } = req.body;

    const data = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ success: false, error: 'Section name cannot be empty.' });
      data.name = name.trim();
    }
    if (gradeLevel !== undefined) data.gradeLevel = gradeLevel || null;
    if (teacherId !== undefined && teacherId !== section.teacherId) {
      // Reassigning the adviser must stay inside the school.
      const nextTeacher = await prisma.user.findUnique({ where: { id: teacherId } });
      if (!nextTeacher || nextTeacher.role !== 'TEACHER' || nextTeacher.schoolId !== admin.schoolId) {
        return res.status(400).json({ success: false, error: 'Choose a teacher from your own school.' });
      }
      data.teacherId = teacherId;
    }

    const updated = await prisma.section.update({
      where: { id: section.id },
      data,
      include: { teacher: { select: { id: true, name: true } } }
    });
    res.json({ success: true, section: updated });
  } catch (e) { sendAdminError(res, e); }
});

/** Add students to a section by name. */
app.post('/api/admin/:adminId/sections/:sectionId/students', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const section = await sectionInSchool(admin, req.params.sectionId);
    const { studentsList } = req.body;
    if (!Array.isArray(studentsList) || studentsList.length === 0) {
      return res.status(400).json({ success: false, error: 'Provide at least one student name.' });
    }

    const result = await enrolStudents(section, studentsList, {
      schoolId: admin.schoolId,
      teacherId: section.teacherId
    });

    const parts = [];
    if (result.createdStudents.length) parts.push(`${result.createdStudents.length} new account(s) created`);
    if (result.linkedStudents.length) parts.push(`${result.linkedStudents.length} existing account(s) moved here`);
    if (result.skippedStudents.length) parts.push(`${result.skippedStudents.length} already in this section`);
    res.json({ success: true, ...result, message: parts.join(', ') || 'No changes.' });
  } catch (e) { sendAdminError(res, e); }
});

/** Remove a student from a section — deletes the account when it has no work. */
app.delete('/api/admin/:adminId/sections/:sectionId/students/:studentId', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const section = await sectionInSchool(admin, req.params.sectionId);
    const student = await prisma.user.findUnique({
      where: { id: req.params.studentId },
      include: { _count: { select: { submissions: true } } }
    });
    if (!student || student.sectionId !== section.id || student.role !== 'STUDENT') {
      return res.status(404).json({ success: false, error: 'Student not found in this section.' });
    }

    if (student._count.submissions > 0) {
      // Graded work must survive, so unassign rather than delete the account.
      await prisma.user.update({ where: { id: student.id }, data: { sectionId: null } });
      return res.json({ success: true, detached: true, message: `${student.name} has submitted work, so their account was kept and only removed from this section.` });
    }
    await prisma.user.delete({ where: { id: student.id } });
    res.json({ success: true, detached: false, message: `${student.name} was removed.` });
  } catch (e) { sendAdminError(res, e); }
});

/** Delete a section, once nothing depends on it. */
app.delete('/api/admin/:adminId/sections/:sectionId', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const section = await sectionInSchool(admin, req.params.sectionId);
    const [classCount, studentCount] = await Promise.all([
      prisma.class.count({ where: { sectionId: section.id } }),
      prisma.user.count({ where: { sectionId: section.id, role: 'STUDENT' } })
    ]);
    if (classCount > 0) {
      return res.status(400).json({ success: false, error: `${classCount} class(es) still use this section. Delete those first.` });
    }
    if (studentCount > 0) {
      return res.status(400).json({ success: false, error: `Remove the ${studentCount} student(s) from this section first.` });
    }
    await prisma.section.delete({ where: { id: section.id } });
    res.json({ success: true });
  } catch (e) { sendAdminError(res, e); }
});

// ── Curriculums ──

/**
 * Promotes the rubrics the AI generated for each lesson into real, reusable
 * school rubric templates tagged with the curriculum's grade level + subject.
 *
 * Without this the rubric only lived inside CurriculumLesson.defaultRubric, so
 * a teacher could only reach it by picking that exact lesson. Lessons often
 * share one rubric shape, so identical ones are collapsed by name.
 *
 * Returns how many distinct templates were saved.
 */
async function saveCurriculumRubrics(curriculum, lessons) {
  const byName = new Map();

  for (const lesson of lessons) {
    const criteria = lesson.defaultRubric?.criteria;
    if (!Array.isArray(criteria) || criteria.length === 0) continue;

    // Weights must total 100 to be usable in the activity builder.
    const total = criteria.reduce((sum, c) => sum + (parseInt(c.points) || 0), 0);
    if (total !== 100) continue;

    const outputType = lesson.outputType || 'Essay';
    // Name by what the rubric grades, not by the lesson — a "Survey/Form"
    // rubric is reusable across every survey lesson in the curriculum.
    const name = `${outputType} — ${curriculum.subject} ${curriculum.gradeLevel}`;
    if (!byName.has(name)) byName.set(name, { name, outputType, criteria });
  }

  if (byName.size === 0) return 0;

  // Don't duplicate a template the school already has under the same name.
  const existing = await prisma.rubricTemplate.findMany({
    where: { schoolId: curriculum.schoolId, name: { in: [...byName.keys()] } },
    select: { name: true }
  });
  const taken = new Set(existing.map(r => r.name));
  const fresh = [...byName.values()].filter(r => !taken.has(r.name));
  if (fresh.length === 0) return 0;

  await prisma.rubricTemplate.createMany({
    data: fresh.map(r => ({
      name: r.name,
      criteria: JSON.stringify(r.criteria),
      schoolId: curriculum.schoolId,
      teacherId: null,
      gradeLevel: curriculum.gradeLevel,
      subject: curriculum.subject,
      curriculumId: curriculum.id,
      outputType: r.outputType
    }))
  });
  console.log(`📐 Saved ${fresh.length} rubric template(s) from curriculum "${curriculum.title}"`);
  return fresh.length;
}

app.get('/api/admin/:adminId/curriculums', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const curriculums = await prisma.curriculum.findMany({
      where: { schoolId: admin.schoolId },
      include: { lessons: { orderBy: [{ weekNumber: 'asc' }, { createdAt: 'asc' }] } },
      orderBy: [{ gradeLevel: 'asc' }, { subject: 'asc' }]
    });
    res.json({ success: true, curriculums });
  } catch (e) { sendAdminError(res, e); }
});

/**
 * Publish a curriculum for one grade level + subject. An uploaded PDF/DOCX is
 * parsed by the same extractor the per-class flow uses, so an admin gets
 * lessons + default rubrics generated once for the whole school.
 */
app.post('/api/admin/:adminId/curriculums', upload.single('curriculumFile'), async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const { gradeLevel, subject, title, description } = req.body;
    if (!gradeLevel || !subject || !title?.trim()) {
      return res.status(400).json({ success: false, error: 'Grade level, subject and title are required.' });
    }

    const duplicate = await prisma.curriculum.findFirst({
      where: { schoolId: admin.schoolId, gradeLevel, subject }
    });
    if (duplicate) {
      return res.status(400).json({
        success: false,
        error: `${subject} for ${gradeLevel} already has a curriculum. Delete it first to replace it.`
      });
    }

    const sourceFile = req.file
      ? await uploadToCloud(req.file.path, req.file.filename, { folder: 'curriculum', contentType: req.file.mimetype })
      : null;

    const curriculum = await prisma.curriculum.create({
      data: { schoolId: admin.schoolId, gradeLevel, subject, title: title.trim(), description: description || null, sourceFile }
    });

    let parseWarning = null;
    let savedRubrics = 0;
    if (req.file) {
      try {
        const lessons = await extractLessonsFromCurriculum(req.file.path, subject, gradeLevel);
        if (lessons.length) {
          await prisma.curriculumLesson.createMany({
            data: lessons.map(l => ({
              curriculumId: curriculum.id,
              title: l.title,
              description: l.description || null,
              outputType: l.outputType || 'Essay',
              weekNumber: l.weekNumber ?? null,
              defaultRubric: l.defaultRubric ? JSON.stringify(l.defaultRubric) : null
            }))
          });
          savedRubrics = await saveCurriculumRubrics(curriculum, lessons);
        } else {
          parseWarning = 'No lessons could be extracted from that file. You can still add them by hand.';
        }
      } catch (parseErr) {
        parseWarning = 'Curriculum file could not be parsed: ' + parseErr.message;
      }
    }

    const saved = await prisma.curriculum.findUnique({
      where: { id: curriculum.id },
      include: { lessons: true, rubrics: true }
    });
    res.json({ success: true, curriculum: saved, savedRubrics, warning: parseWarning });
  } catch (e) { sendAdminError(res, e); }
});

/**
 * Save this curriculum's lesson rubrics as reusable school templates.
 *
 * Upload does this automatically; this endpoint covers curriculums that
 * predate the feature or whose lessons were added by hand afterwards.
 */
app.post('/api/admin/:adminId/curriculums/:curriculumId/promote-rubrics', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const curriculum = await prisma.curriculum.findUnique({
      where: { id: req.params.curriculumId },
      include: { lessons: true }
    });
    if (!curriculum || curriculum.schoolId !== admin.schoolId) {
      return res.status(404).json({ success: false, error: 'Curriculum not found in your school.' });
    }

    // saveCurriculumRubrics works on the parser's shape, so reparse the stored JSON.
    const lessons = curriculum.lessons.map(l => {
      let defaultRubric = null;
      try { defaultRubric = l.defaultRubric ? JSON.parse(l.defaultRubric) : null; } catch { /* skip malformed */ }
      return { outputType: l.outputType, defaultRubric };
    });

    const savedRubrics = await saveCurriculumRubrics(curriculum, lessons);
    res.json({ success: true, savedRubrics });
  } catch (e) { sendAdminError(res, e); }
});

app.post('/api/admin/:adminId/curriculums/:curriculumId/lessons', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const curriculum = await prisma.curriculum.findUnique({ where: { id: req.params.curriculumId } });
    if (!curriculum || curriculum.schoolId !== admin.schoolId) {
      return res.status(404).json({ success: false, error: 'Curriculum not found in your school.' });
    }
    const { title, description, outputType, weekNumber, defaultRubric } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, error: 'Lesson title is required.' });
    const lesson = await prisma.curriculumLesson.create({
      data: {
        curriculumId: curriculum.id,
        title: title.trim(),
        description: description || null,
        outputType: outputType || 'Essay',
        weekNumber: weekNumber ? parseInt(weekNumber) : null,
        // Optional — lets a hand-added lesson carry a rubric the same way a
        // parsed one does, so it can be promoted to a school template too.
        defaultRubric: defaultRubric ? JSON.stringify(defaultRubric) : null
      }
    });
    res.json({ success: true, lesson });
  } catch (e) { sendAdminError(res, e); }
});

app.delete('/api/admin/:adminId/curriculums/:curriculumId/lessons/:lessonId', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const lesson = await prisma.curriculumLesson.findUnique({
      where: { id: req.params.lessonId },
      include: { curriculum: true }
    });
    if (!lesson || lesson.curriculum.schoolId !== admin.schoolId) {
      return res.status(404).json({ success: false, error: 'Lesson not found in your school.' });
    }
    await prisma.curriculumLesson.delete({ where: { id: lesson.id } });
    res.json({ success: true });
  } catch (e) { sendAdminError(res, e); }
});

app.delete('/api/admin/:adminId/curriculums/:curriculumId', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const curriculum = await prisma.curriculum.findUnique({ where: { id: req.params.curriculumId } });
    if (!curriculum || curriculum.schoolId !== admin.schoolId) {
      return res.status(404).json({ success: false, error: 'Curriculum not found in your school.' });
    }
    await prisma.curriculum.delete({ where: { id: curriculum.id } });
    res.json({ success: true });
  } catch (e) { sendAdminError(res, e); }
});

// ── School-wide rubric templates ──

app.get('/api/admin/:adminId/rubrics', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const { gradeLevel, subject } = req.query;
    const rubrics = await prisma.rubricTemplate.findMany({
      where: {
        schoolId: admin.schoolId,
        ...(gradeLevel ? { gradeLevel } : {}),
        ...(subject ? { subject } : {})
      },
      include: { curriculum: { select: { id: true, title: true } } },
      orderBy: [{ gradeLevel: 'asc' }, { subject: 'asc' }, { createdAt: 'desc' }]
    });
    res.json({ success: true, rubrics });
  } catch (e) { sendAdminError(res, e); }
});

app.post('/api/admin/:adminId/rubrics', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const { name, criteria, gradeLevel, subject, outputType } = req.body;
    if (!name?.trim() || !Array.isArray(criteria) || criteria.length === 0) {
      return res.status(400).json({ success: false, error: 'A name and at least one criterion are required.' });
    }
    const total = criteria.reduce((sum, c) => sum + (parseInt(c.points) || 0), 0);
    if (total !== 100) {
      return res.status(400).json({ success: false, error: `Criteria weights must total 100%. They currently total ${total}%.` });
    }
    const rubric = await prisma.rubricTemplate.create({
      data: {
        name: name.trim(),
        criteria: JSON.stringify(criteria),
        schoolId: admin.schoolId,
        teacherId: null,
        // Null on either means the rubric applies to any grade level / subject.
        gradeLevel: gradeLevel || null,
        subject: subject || null,
        outputType: outputType || null
      }
    });
    res.json({ success: true, rubric });
  } catch (e) { sendAdminError(res, e); }
});

/** Retag an existing rubric's grade level / subject. */
app.put('/api/admin/:adminId/rubrics/:rubricId', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const rubric = await prisma.rubricTemplate.findUnique({ where: { id: req.params.rubricId } });
    if (!rubric || rubric.schoolId !== admin.schoolId) {
      return res.status(404).json({ success: false, error: 'Rubric not found in your school.' });
    }
    const { name, gradeLevel, subject, outputType } = req.body;
    const data = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ success: false, error: 'Name cannot be empty.' });
      data.name = name.trim();
    }
    if (gradeLevel !== undefined) data.gradeLevel = gradeLevel || null;
    if (subject !== undefined) data.subject = subject || null;
    if (outputType !== undefined) data.outputType = outputType || null;

    const updated = await prisma.rubricTemplate.update({ where: { id: rubric.id }, data });
    res.json({ success: true, rubric: updated });
  } catch (e) { sendAdminError(res, e); }
});

app.delete('/api/admin/:adminId/rubrics/:rubricId', async (req, res) => {
  try {
    const admin = await requireAdminSchool(req.params.adminId);
    const rubric = await prisma.rubricTemplate.findUnique({ where: { id: req.params.rubricId } });
    if (!rubric || rubric.schoolId !== admin.schoolId) {
      return res.status(404).json({ success: false, error: 'Rubric not found in your school.' });
    }
    await prisma.rubricTemplate.delete({ where: { id: rubric.id } });
    res.json({ success: true });
  } catch (e) { sendAdminError(res, e); }
});

/**
 * Curriculum suggested for a teacher creating a course shell. Matched on the
 * teacher's school + the grade level and subject they just picked.
 */
app.get('/api/teacher/:teacherId/curriculum-suggestion', async (req, res) => {
  try {
    const { gradeLevel, subject } = req.query;
    const teacher = await prisma.user.findUnique({ where: { id: req.params.teacherId } });
    if (!teacher?.schoolId || !gradeLevel || !subject) return res.json({ success: true, curriculum: null });

    const curriculum = await prisma.curriculum.findFirst({
      where: { schoolId: teacher.schoolId, gradeLevel, subject },
      include: { lessons: { orderBy: [{ weekNumber: 'asc' }, { createdAt: 'asc' }] } }
    });
    res.json({ success: true, curriculum });
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
  // Sections are shared across a school: colleagues teach the same block, so
  // every teacher in the school sees them. Teachers with no school yet fall
  // back to just their own, so nothing leaks between unaffiliated accounts.
  const teacher = await prisma.user.findUnique({ where: { id: req.params.teacherId } });
  const where = teacher?.schoolId
    ? { OR: [{ schoolId: teacher.schoolId }, { teacherId: teacher.id }] }
    : { teacherId: req.params.teacherId };

  const sections = await prisma.section.findMany({
    where,
    include: {
      _count: { select: { students: true } },
      students: { select: { id: true, name: true, username: true } },
      teacher: { select: { id: true, name: true } }
    },
    orderBy: [{ gradeLevel: 'asc' }, { name: 'asc' }]
  });
  // `isOwn` lets the UI show which sections this teacher may edit.
  res.json({
    success: true,
    sections: sections.map(s => ({ ...s, isOwn: s.teacherId === req.params.teacherId }))
  });
});

app.post('/api/teacher/extract-students', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded.' });

    const mime = req.file.mimetype;
    let names = [];
    const fs = require('fs');

    // Excel processing
    if (mime.includes('spreadsheetml.sheet') || mime.includes('ms-excel') || mime.includes('excel')) {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(req.file.path);
      const sheet = workbook.worksheets[0];
      let rawText = '';
      if (sheet) {
        sheet.eachRow((row) => {
          row.eachCell((cell) => {
            if (cell.value && typeof cell.value === 'string') {
              rawText += cell.value.trim() + ' | ';
            }
          });
          rawText += '\n';
        });
      }
      
      if (!model) return res.status(500).json({ success: false, error: 'Gemini AI is not configured.' });
      const prompt = "Extract ONLY the full names of the students from the following raw spreadsheet text. DO NOT include any headers, IDs, grades, dates, titles (like 'List of Students' or 'Section A'), or other extraneous text. Return a pure JSON array of strings containing only the names, like [\"Juan Dela Cruz\", \"Maria Clara\"]. Do not add any markdown formatting or conversational text.\n\nText data:\n" + rawText;
      const result = await generateContentWithFallback(model, prompt);
      let text = result.response.text().trim();
      if (text.startsWith('```json')) text = text.replace(/^```json/, '').replace(/```$/, '').trim();
      if (text.startsWith('```')) text = text.replace(/^```/, '').replace(/```$/, '').trim();

      let parsedNames = [];
      try { parsedNames = JSON.parse(text); } catch (e) { parsedNames = text.split('\n'); }
      names = parsedNames.map(n => typeof n === 'string' ? n.trim().replace(/^[-*.\d\s]+/, '') : '').filter(n => n.length > 3);
    }
    // Image processing with Gemini
    else if (mime.startsWith('image/')) {
      if (!model) return res.status(500).json({ success: false, error: 'Gemini AI is not configured.' });
      const fileData = fs.readFileSync(req.file.path);
      
      const prompt = "Extract ONLY the full names of the students from this image. DO NOT include any headers, IDs, grades, dates, titles, or other extraneous text. Return a pure JSON array of strings containing only the names, like [\"Juan Dela Cruz\", \"Maria Clara\"]. Do not add any markdown formatting or conversational text.";
      const imagePart = {
        inlineData: {
          data: fileData.toString('base64'),
          mimeType: mime
        }
      };
      
      const result = await generateContentWithFallback(model, [prompt, imagePart]);
      let text = result.response.text().trim();
      if (text.startsWith('```json')) text = text.replace(/^```json/, '').replace(/```$/, '').trim();
      if (text.startsWith('```')) text = text.replace(/^```/, '').replace(/```$/, '').trim();
      
      let parsedNames = [];
      try { parsedNames = JSON.parse(text); } catch (e) { parsedNames = text.split('\n'); }
      names = parsedNames.map(n => typeof n === 'string' ? n.trim().replace(/^[-*.\d\s]+/, '') : '').filter(n => n.length > 3);
    } else {
      return res.status(400).json({ success: false, error: 'Unsupported file type. Please upload Excel or Image files.' });
    }

    // Clean up uploaded file
    try { fs.unlinkSync(req.file.path); } catch (err) {}

    res.json({ success: true, names });
  } catch (error) {
    console.error('Extract Students Error:', error);
    try { if (req.file && req.file.path) require('fs').unlinkSync(req.file.path); } catch (e) {}
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Adds student names to a section, creating accounts as needed.
 *
 * Names already in the section are skipped; names that already have an account
 * elsewhere in the same school are re-homed rather than duplicated. Never
 * crosses into another school — two schools may both have a "Maria Santos".
 *
 * Shared by the teacher roster flow and the admin console.
 */
async function enrolStudents(section, studentsList, { schoolId, teacherId }) {
  const createdStudents = [];
  const skippedStudents = [];
  const linkedStudents = [];
  const names = (studentsList || []).filter(n => n && n.trim());
  if (names.length === 0) return { createdStudents, skippedStudents, linkedStudents };

  const defaultStudentPassword = await bcrypt.hash('password123', BCRYPT_SALT_ROUNDS);

  const sectionStudents = await prisma.user.findMany({ where: { sectionId: section.id, role: 'STUDENT' } });
  const sectionNamesSet = new Set(sectionStudents.map(s => s.name.toLowerCase().trim()));
  let count = sectionStudents.length + 1;

  // Fetched once rather than per name — this used to be an N-query loop.
  const schoolStudents = await prisma.user.findMany({
    where: { role: 'STUDENT', section: schoolId ? { schoolId } : { teacherId } }
  });

  for (const studentName of names) {
    const normalizedName = studentName.toLowerCase().trim();

    if (sectionNamesSet.has(normalizedName)) {
      skippedStudents.push({ name: studentName.trim(), reason: 'Already in this section' });
      continue;
    }

    const existingAccount = schoolStudents.find(s => s.name.toLowerCase().trim() === normalizedName);
    if (existingAccount) {
      await prisma.user.update({ where: { id: existingAccount.id }, data: { sectionId: section.id } });
      linkedStudents.push({ name: studentName.trim(), username: existingAccount.username, from: 'existing account' });
      sectionNamesSet.add(normalizedName);
      continue;
    }

    // Student IDs are derived from the section name, e.g. "Grade 6 - Rizal" -> RIZAL-001
    const prefix = section.name.split('-')[1]?.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'SEC';
    let studentId = `${prefix}-${String(count).padStart(3, '0')}`;
    while (await prisma.user.findUnique({ where: { username: studentId } })) {
      count++;
      studentId = `${prefix}-${String(count).padStart(3, '0')}`;
    }

    const user = await prisma.user.create({
      data: { name: studentName.trim(), username: studentId, password: defaultStudentPassword, role: 'STUDENT', sectionId: section.id }
    });
    const { password: _pw, ...safeUser } = user;
    createdStudents.push(safeUser);
    sectionNamesSet.add(normalizedName);
    count++;
  }

  return { createdStudents, skippedStudents, linkedStudents };
}

app.post('/api/teacher/sections', async (req, res) => {
  try {
    const { name, teacherId, studentsList, gradeLevel } = req.body;
    const creator = await prisma.user.findUnique({ where: { id: teacherId } });
    const schoolId = creator?.schoolId || null;

    // 1) Reuse an existing section with this name from the same school (or from
    //    this teacher when they have no school). Scoped so two schools can both
    //    have a "Grade 6 - Sampaguita" without sharing one section record.
    let section = await prisma.section.findFirst({
      where: schoolId ? { name: name.trim(), schoolId } : { name: name.trim(), teacherId }
    });
    let isExisting = false;

    if (section) {
      isExisting = true;
      // Backfill grade level if the section predates the field.
      if (gradeLevel && !section.gradeLevel) {
        section = await prisma.section.update({ where: { id: section.id }, data: { gradeLevel } });
      }
    } else {
      section = await prisma.section.create({
        data: { name: name.trim(), teacherId, schoolId, gradeLevel: gradeLevel || null }
      });
    }

    const { createdStudents, skippedStudents, linkedStudents } =
      await enrolStudents(section, studentsList, { schoolId, teacherId });

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

// Class creation: accepts BOTH multipart/form-data (with curriculum file) and JSON
app.post('/api/teacher/classes', (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    upload.single('curriculumFile')(req, res, next);
  } else {
    next();
  }
}, async (req, res) => {
  try {
    const { name, gradeLevel, subject, schoolYear, teacherId, sectionId, curriculumId } = req.body;
    if (!sectionId || !teacherId) {
      return res.status(400).json({ success: false, error: 'Missing required fields: sectionId and teacherId are required.' });
    }

    // Guard against double-submits (impatient click, retried request): the same
    // teacher + section + subject + school year is always the same course shell.
    const duplicate = await prisma.class.findFirst({
      where: { teacherId, sectionId, schoolYear, subject: subject || null, gradeLevel: gradeLevel || null }
    });
    if (duplicate) {
      return res.json({ success: true, class: duplicate, duplicate: true });
    }

    const curriculumFile = req.file
      ? await uploadToCloud(req.file.path, req.file.filename, { folder: 'curriculum', contentType: req.file.mimetype })
      : null;
    const newClass = await prisma.class.create({
      data: { name, gradeLevel, subject, schoolYear, teacherId, sectionId, curriculumFile }
    });

    // Apply the school curriculum the teacher accepted: copy its lesson
    // templates into this class so activities can be mapped to them.
    let appliedLessons = 0;
    if (curriculumId) {
      const teacher = await prisma.user.findUnique({ where: { id: teacherId } });
      const curriculum = await prisma.curriculum.findUnique({
        where: { id: curriculumId },
        include: { lessons: true }
      });
      if (curriculum && teacher?.schoolId === curriculum.schoolId && curriculum.lessons.length) {
        await prisma.classLesson.createMany({
          data: curriculum.lessons.map(l => ({
            classId: newClass.id,
            title: l.title,
            description: l.description,
            outputType: l.outputType,
            weekNumber: l.weekNumber,
            defaultRubric: l.defaultRubric
          }))
        });
        appliedLessons = curriculum.lessons.length;
      }
    }

    res.json({ success: true, class: newClass, appliedLessons });
  } catch (e) {
    console.error('❌ Class creation error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Parse uploaded curriculum file and generate ClassLesson records with default rubrics
/**
 * Runs a curriculum/lesson-plan document through the AI extractor and returns
 * plain lesson objects. Shared by the per-class parse endpoint and the
 * school-wide admin curriculum builder.
 */
async function extractLessonsFromCurriculum(filePath, subjectInput, gradeLevelInput) {
    if (!aiConfigured || !model) {
      throw new Error('AI is not configured. Cannot parse curriculum.');
    }
    if (!fs.existsSync(filePath)) throw new Error('Curriculum file not found on disk');

    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    let mimeType = 'application/pdf';
    if (ext === '.docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (ext === '.doc') mimeType = 'application/msword';

    const subject = subjectInput || 'English';
    const gradeLevel = gradeLevelInput || 'Grade 6';

    const parsePrompt = `You are an expert curriculum analyst for the Philippine DepEd K-12 MATATAG system.

Analyze this uploaded curriculum/lesson plan document for ${subject} at ${gradeLevel} level.

Extract ALL individual lessons, topics, or weekly units from the document. For each lesson, generate a default grading rubric appropriate for the lesson's expected output type.

You MUST respond with valid JSON matching this exact schema:
{
  "lessons": [
    {
      "title": "<Lesson/topic/week title, e.g. 'Week 1: Elements of a Short Story'>",
      "description": "<Brief 1-2 sentence description of what the lesson covers>",
      "weekNumber": <integer week number if identifiable, or null>,
      "outputType": "<One of: Essay, Short Answer, Journal, Reflection, Creative Writing, Research Paper, Survey/Form, Outline, Report, Letter, Poem, Speech, Summary>",
      "defaultRubric": {
        "criteria": [
          {
            "name": "<Criterion name, e.g. Content & Ideas>",
            "points": <percentage weight, all criteria must sum to 100>,
            "description": "<What this criterion evaluates>",
            "bands": [
              { "label": "Outstanding", "score": "<point range e.g. 36-40>", "description": "<description>" },
              { "label": "Proficient", "score": "<point range>", "description": "<description>" },
              { "label": "Developing", "score": "<point range>", "description": "<description>" },
              { "label": "Beginning", "score": "<point range>", "description": "<description>" }
            ]
          }
        ]
      }
    }
  ]
}

RULES:
- Extract EVERY lesson/topic/week you can find in the document.
- Each rubric's criteria point percentages MUST sum to exactly 100.
- The outputType should reflect the most likely student output for that lesson.
- Keep rubric criteria practical and aligned with DepEd standards.
- Generate 3-4 criteria per rubric, each with 4 scoring bands.
- If the document structure is unclear, organize by logical topic groupings.`;

    const fileParts = [{
      inlineData: {
        data: fileBuffer.toString('base64'),
        mimeType
      }
    }];

    const result = await generateContentWithFallback(model, [parsePrompt, ...fileParts]);
    const text = result.response.text();
    let cleaned = text
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .replace(/^[^{]*/, '')
      .replace(/[^}]*$/, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    return parsed.lessons || [];
}

app.post('/api/teacher/classes/:id/parse-curriculum', async (req, res) => {
  try {
    const classRecord = await prisma.class.findUnique({
      where: { id: req.params.id },
      select: { id: true, curriculumFile: true, subject: true, gradeLevel: true }
    });
    if (!classRecord) return res.status(404).json({ success: false, error: 'Class not found' });
    if (!classRecord.curriculumFile) return res.status(400).json({ success: false, error: 'No curriculum file uploaded for this class' });

    const filePath = path.join(__dirname, classRecord.curriculumFile);
    const lessons = await extractLessonsFromCurriculum(filePath, classRecord.subject, classRecord.gradeLevel);

    if (lessons.length === 0) {
      return res.json({ success: true, lessons: [], message: 'No lessons found in the document.' });
    }

    // Delete any existing lessons for this class (re-parse)
    await prisma.classLesson.deleteMany({ where: { classId: classRecord.id } });

    // Create ClassLesson records
    const createdLessons = [];
    for (const lesson of lessons) {
      const created = await prisma.classLesson.create({
        data: {
          classId: classRecord.id,
          title: lesson.title || 'Untitled Lesson',
          description: lesson.description || null,
          weekNumber: lesson.weekNumber || null,
          outputType: lesson.outputType || 'Essay',
          defaultRubric: lesson.defaultRubric ? JSON.stringify(lesson.defaultRubric) : null
        }
      });
      createdLessons.push(created);
    }

    console.log(`📚 Parsed ${createdLessons.length} lessons from curriculum for class ${classRecord.id}`);
    res.json({ success: true, lessons: createdLessons });
  } catch (e) {
    console.error('Curriculum parse error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get lessons for a class
app.get('/api/teacher/classes/:id/lessons', async (req, res) => {
  try {
    const lessons = await prisma.classLesson.findMany({
      where: { classId: req.params.id },
      orderBy: [{ weekNumber: 'asc' }, { createdAt: 'asc' }]
    });
    res.json({ success: true, lessons });
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
/**
 * Attempts allowed on a student-submit activity. `0` means unlimited — stored
 * as 0 rather than null so the existing Int column needs no migration.
 */
function normalizeMaxAttempts(value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 0) return 1;
  return n;   // 0 === unlimited
}

app.post('/api/teacher/activities', (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    upload.array('additionalFiles', 10)(req, res, next);
  } else {
    next();
  }
}, async (req, res) => {
  try {
    const { title, type, points, classId, instructions, deadline, submissionMode, rubric, topic, maxAttempts, classLessonId } = req.body;
    const filePaths = await Promise.all(
      (req.files || []).map(f => uploadToCloud(f.path, f.filename, { folder: 'activity-files', contentType: f.mimetype }))
    );
    const activity = await prisma.activity.create({
      data: {
        title, type,
        topic: topic || null,
        points: parseInt(points) || 100,
        classId, instructions,
        deadline: deadline || null,
        submissionMode: submissionMode || 'TEACHER_UPLOAD',
        maxAttempts: normalizeMaxAttempts(maxAttempts),
        additionalFiles: filePaths.length ? JSON.stringify(filePaths) : null,
        rubric: rubric || null,
        classLessonId: classLessonId || null
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
    const { title, type, points, topic, deadline, instructions, submissionMode, maxAttempts, rubric } = req.body;
    const updateData = {};
    if (title !== undefined) updateData.title = String(title);
    if (type !== undefined) updateData.type = String(type);
    if (points !== undefined) updateData.points = parseInt(points);
    if (topic !== undefined) updateData.topic = topic ? String(topic) : null;
    if (deadline !== undefined) updateData.deadline = deadline ? String(deadline) : null;
    if (instructions !== undefined) updateData.instructions = instructions ? String(instructions) : null;
    if (submissionMode !== undefined) updateData.submissionMode = String(submissionMode);
    if (maxAttempts !== undefined) updateData.maxAttempts = normalizeMaxAttempts(maxAttempts);
    if (rubric !== undefined) updateData.rubric = rubric || null;
    if (req.body.classLessonId !== undefined) updateData.classLessonId = req.body.classLessonId || null;

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
    
    const subCount = await prisma.submission.count({ where: { activityId } });
    if (subCount > 0) {
      return res.status(400).json({ success: false, error: 'Cannot delete activity. Students have already uploaded submissions.' });
    }

    await prisma.activity.delete({ where: { id: activityId } });
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
    // A teacher's own templates plus any their admin published school-wide.
    // ?gradeLevel=&subject= narrows school rubrics to the ones tagged for that
    // class (untagged ones apply everywhere, so they always come through).
    const { gradeLevel, subject } = req.query;
    const teacher = await prisma.user.findUnique({ where: { id: req.params.teacherId } });

    const schoolScope = { schoolId: teacher?.schoolId };
    if (gradeLevel) schoolScope.OR = [{ gradeLevel }, { gradeLevel: null }];
    if (subject) schoolScope.AND = [{ OR: [{ subject }, { subject: null }] }];

    const templates = await prisma.rubricTemplate.findMany({
      where: teacher?.schoolId
        ? { OR: [{ teacherId: req.params.teacherId }, schoolScope] }
        : { teacherId: req.params.teacherId },
      orderBy: { createdAt: 'desc' }
    });
    res.json({
      success: true,
      templates: templates.map(t => ({ ...t, isSchoolWide: !!t.schoolId }))
    });
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

app.put('/api/teacher/rubric-templates/:id', async (req, res) => {
  try {
    const { name, criteria } = req.body;
    if (!name || !criteria) return res.status(400).json({ success: false, error: 'Missing fields' });
    
    const template = await prisma.rubricTemplate.update({
      where: { id: req.params.id },
      data: {
        name: String(name),
        criteria: typeof criteria === 'string' ? criteria : JSON.stringify(criteria)
      }
    });
    res.json({ success: true, template });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/teacher/rubric-templates/:id', async (req, res) => {
  try {
    await prisma.rubricTemplate.delete({
      where: { id: req.params.id }
    });
    res.json({ success: true });
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
      model: 'gemini-3.5-flash',
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

    const result = await generateContentWithFallback(model, [
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

app.get('/api/activities/:activityId', async (req, res) => {
  const activity = await prisma.activity.findUnique({
    where: { id: req.params.activityId },
    include: { class: { select: { id: true, name: true } } }
  });
  if (!activity) return res.status(404).json({ success: false, error: 'Activity not found' });
  res.json({ success: true, activity });
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

/**
 * Combine one or more uploaded page images into a single local image file.
 * A single file is returned as-is; multiple files are stitched vertically so
 * multi-page outputs reach the AI as one continuous document.
 * Returns { path, filename, isStitched }.
 */
async function stitchPages(imageFiles) {
  if (imageFiles.length === 1) {
    return { path: imageFiles[0].path, filename: imageFiles[0].filename, isStitched: false };
  }

  const metadataList = await Promise.all(imageFiles.map(f => sharp(f.path).metadata()));
  const totalHeight = metadataList.reduce((sum, m) => sum + (m.height || 0), 0);
  const maxWidth = Math.max(...metadataList.map(m => m.width || 0));

  let currentTop = 0;
  const compositeOps = imageFiles.map((f, i) => {
    const op = { input: f.path, top: currentTop, left: 0 };
    currentTop += metadataList[i].height || 0;
    return op;
  });

  const outFilename = `stitched-${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`;
  const outPath = path.join(__dirname, 'uploads', outFilename);

  await sharp({
    create: { width: maxWidth, height: totalHeight, channels: 3, background: { r: 255, g: 255, b: 255 } }
  })
    .composite(compositeOps)
    .jpeg({ quality: 85 })
    .toFile(outPath);

  // Cleanup the individual uploaded parts
  imageFiles.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });

  return { path: outPath, filename: outFilename, isStitched: true };
}

// ─────────────────────────────────────────
// VLM UPLOAD (Gemini Vision)
// ─────────────────────────────────────────

async function generateSubmissionFeedback(imagePath, activityId, studentId) {
    // Formats a criteria array into the "MANDATORY RUBRIC" prompt block, shared by all rubric tiers below.
    function formatRubricCriteria(criteria, sourceLabel) {
      return `MANDATORY RUBRIC${sourceLabel ? ` (${sourceLabel})` : ''} — You MUST use this rubric for scoring. Do NOT use any default rubric.\n\n` +
        criteria.map((c, i) => {
          let entry = `CRITERION ${i+1}: ${c.name} (${c.points || 0} points maximum)\n`;
          entry += `  Description: ${c.description || 'N/A'}\n`;
          if (c.bands?.length) {
            entry += `  Scoring Bands:\n` + c.bands.map(b =>
              `    • ${b.label} (${b.range || b.score} pts): ${b.description}`
            ).join('\n');
          }
          return entry;
        }).join('\n\n') +
        `\n\nSCORING INSTRUCTIONS:\n` +
        `- Grade each criterion independently within its point range.\n` +
        `- The total score = sum of all criterion scores, scaled to 0-100.\n` +
        `- In your rubricScores array, list each criterion with its name, score, maxPoints, and bandDescription.\n` +
        `- Your "score" field must equal the sum, scaled to percentage.`;
    }

    // 2) Fetch activity + resolve rubric context via 3-tier fallback:
    //    Activity.rubric -> ClassLesson.defaultRubric -> topic's recommended rubric template -> generic default
    let rubricContext = 'Use standard DepEd essay rubric: Content & Ideas (40 pts: 35-40 Outstanding, 25-34 Proficient, 15-24 Developing, 0-14 Beginning), Organization (30 pts: 27-30 Outstanding, 19-26 Proficient, 10-18 Developing, 0-9 Beginning), Language & Grammar (30 pts: 27-30 Outstanding, 19-26 Proficient, 10-18 Developing, 0-9 Beginning).';
    let activityContext = '';
    let subjectForPrompt = 'English';
    let classLessonContext = '';
    let activity = null;
    if (activityId && activityId !== 'mock-activity-id') {
      activity = await prisma.activity.findUnique({
        where: { id: activityId },
        include: {
          class: { select: { subject: true } },
          classLesson: { select: { title: true, description: true, outputType: true, defaultRubric: true } }
        }
      });
      if (activity) {
        activityContext = `Activity: "${activity.title}" (${activity.type}). Instructions: "${activity.instructions || 'N/A'}".`;
        if (activity.class?.subject) subjectForPrompt = activity.class.subject;

        // Tier 1: the activity's own rubric
        if (activity.rubric) {
          try {
            const parsed = JSON.parse(activity.rubric);
            if (parsed.criteria?.length) {
              rubricContext = formatRubricCriteria(parsed.criteria, '');
            }
          } catch { }
        }

        if (activity.classLesson) {
          const cl = activity.classLesson;
          classLessonContext = `\nCURRICULUM LESSON CONTEXT:\nThis activity is mapped to the lesson: "${cl.title}"\nLesson Description: ${cl.description || 'N/A'}\nExpected Output Type: ${cl.outputType}\nYou MUST evaluate this submission specifically against the learning objectives of this lesson.\n`;

          // Tier 2: ClassLesson's default rubric, only if tier 1 didn't already set a real rubric
          if (cl.defaultRubric && rubricContext.startsWith('Use standard DepEd')) {
            try {
              const parsedLesson = JSON.parse(cl.defaultRubric);
              if (parsedLesson.criteria?.length) {
                rubricContext = formatRubricCriteria(parsedLesson.criteria, 'from curriculum lesson plan');
              }
            } catch { }
          }
        }

        // Tier 3: the activity's DepEd topic's recommended rubric template, only if tiers 1-2 didn't set a real rubric
        if (activity.topic && rubricContext.startsWith('Use standard DepEd')) {
          const topicInfo = getTopicById(activity.topic);
          if (topicInfo?.recommendedRubricId) {
            const recommended = getRubricTemplateById(topicInfo.recommendedRubricId);
            if (recommended?.criteria?.length) {
              rubricContext = formatRubricCriteria(recommended.criteria, `recommended for topic "${topicInfo.name}"`);
            }
          }
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

    // 4) Get topic-specific AI evaluation guidance (reuses the activity fetched above)
    let topicGuidance = '';
    if (activity?.topic) {
      topicGuidance = getTopicAIGuidance(activity.topic);
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

    // Determine language for feedback based on subject
    const feedbackLanguage = subjectForPrompt.toLowerCase().includes('filipino') ? 'Filipino' : 'English';
    const languageDirective = feedbackLanguage === 'Filipino'
      ? 'LANGUAGE RULE: You MUST write ALL feedback (strengths, areasForGrowth, actionableSteps, skillExplanations, and readingStrategy) entirely in Filipino. Maintain a strict, clinical, objective tone even in Filipino.'
      : 'LANGUAGE RULE: You MUST write ALL feedback (strengths, areasForGrowth, actionableSteps, skillExplanations, and readingStrategy) entirely in English.';

    const prompt = `You are an objective, strict academic evaluator. You do NOT sugarcoat. You do NOT use overly enthusiastic praise (e.g., 'Great job!', 'Awesome!', 'Well done!'). You focus purely on clinical, constructive criticism based directly on the rubric criteria. You assess a ${gradeLevelForPrompt} student's work in ${subjectForPrompt} under the Philippine DepEd MATATAG curriculum.

${curriculumContext}
${classLessonContext}

YOUR EVALUATION APPROACH:
- Be direct, clinical, and objective. State facts about the student's performance without emotional language.
- Do NOT begin feedback with praise. Start with a neutral factual assessment of what the student produced.
- When noting strengths, state them clinically: "The student demonstrates X" not "Great use of X!"
- When pointing out mistakes, SHOW the student their exact words so they can see the error themselves.
- Give specific, concrete action steps — not vague advice like "improve your grammar."
- ${languageGuide}
- ${languageDirective}

${activityContext}
${topicGuidance ? `\nTOPIC FOCUS RULE:\nThis activity is mapped to the topic/lesson: ${topicGuidance}\nYou MUST focus your feedback STRICTLY on this topic. Do NOT introduce or critique concepts outside of this topic. Evaluate only how well the student demonstrates mastery of this specific skill or lesson.\n` : ''}
${rubricContext}${fewShotExamples}${sectionContext}

IMPORTANT RULES:
- First, check if the image contains readable handwritten or printed text.
- If the image is BLANK, contains only drawings/art with no text, is too blurry to read, or has NO readable written content, you MUST set score to 0, set noTextDetected to true, provide a short explanation in strengths, and leave areasForGrowth and actionableSteps as empty arrays.
- If you CAN read text, grade it normally against the rubric using the structured feedback format below.
- DATA PRIVACY RULE: Do NOT mention or include the student's name anywhere in your feedback.
- TONE RULE: Do NOT use exclamation marks in praise. Do NOT use words like "excellent", "amazing", "wonderful", "fantastic", "brilliant" unless quoting the rubric band label. Be factual and measured.

TASK: In ONE step:
1. Read and transcribe the handwritten student essay from the image.
2. Grade it against the rubric.
3. Provide structured, evidence-based clinical feedback.
4. Generate a personalized reading intervention strategy connected to the weaknesses found.

You MUST respond with valid JSON matching this exact schema:
{
  "score": <total 0-100, use 0 if no readable text>,
  "rubricScores": [
    { "criterionName": "<string>", "score": <number>, "maxPoints": <number>, "bandDescription": "<the FULL descriptive text of the scoring band the student achieved>" }
  ],
  "contentScore": <number>, "contentMax": <number>,
  "organizationScore": <number>, "organizationMax": <number>,
  "grammarScore": <number>, "grammarMax": <number>,
  "strengths": "<1-3 sentences describing what the student did adequately or well. Be factual and measured — no exclamation marks, no enthusiastic language. Reference their actual ideas or phrases.>",
  "areasForGrowth": [
    {
      "studentQuote": "<Copy the EXACT sentence or phrase from the student's essay that contains the error. Must be a real quote from their writing.>",
      "explanation": "<In clear terms, explain what is wrong and how to fix it. Be direct, not harsh.>"
    }
  ],
  "actionableSteps": [
    "<A concrete, bite-sized task the student can do to improve. e.g., 'Rewrite your second sentence using a transition word such as However or Furthermore to connect your ideas.'>" 
  ],
  "skillExplanations": {
    "vocabulary": "<1 sentence explaining why you gave this vocabulary score>",
    "punctuation": "<1 sentence explaining why you gave this punctuation score>",
    "thematicFlow": "<1 sentence explaining why you gave this thematic flow score>",
    "sentenceStructure": "<1 sentence explaining why you gave this sentence structure score>"
  },
  "readingStrategy": "<Personalized 2-sentence reading strategy directly connected to the weaknesses above. Or 'N/A' if no text found.>",
  "noTextDetected": <true if image has no readable text, false otherwise>,
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

    const imgBuffer = fs.readFileSync(imagePath);
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
    const runCoV = false;
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

    return aiResult;
}

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


// Trigger AI grading on an existing PENDING submission
app.post('/api/teacher/submissions/:id/analyze', async (req, res) => {
  try {
    const sub = await prisma.submission.findUnique({ where: { id: req.params.id } });
    if (!sub) return res.status(404).json({ error: 'Submission not found' });
    if (sub.aiScore !== null) return res.status(400).json({ error: 'Already analyzed by AI' });

    // imageUrl is either a local /uploads/... path or a Supabase Storage URL.
    // Submissions uploaded before storage moved to Supabase point at a disk that
    // no longer exists, so say what actually has to happen rather than leaving
    // the teacher on a spinner — the file is unrecoverable and needs re-uploading.
    const missingImage = () => res.status(409).json({
      success: false,
      error: 'The photo for this submission is no longer stored on the server, so it cannot be checked. Ask the student to submit again, or upload a replacement photo yourself.',
      code: 'IMAGE_UNAVAILABLE'
    });

    if (!sub.imageUrl) return missingImage();
    let imagePath, isTemp;
    try {
      ({ path: imagePath, isTemp } = await resolveLocalImagePath(sub.imageUrl));
    } catch {
      return missingImage();
    }
    if (!fs.existsSync(imagePath)) {
      if (isTemp) { try { fs.unlinkSync(imagePath); } catch {} }
      return missingImage();
    }

    let aiData;
    try {
      aiData = await generateSubmissionFeedback(imagePath, sub.activityId, sub.studentId);
    } finally {
      if (isTemp) { try { fs.unlinkSync(imagePath); } catch {} }
    }

    const aiFeedbackStr = JSON.stringify({
      strengths: aiData.strengths,
      areasForGrowth: aiData.areasForGrowth,
      actionableSteps: aiData.actionableSteps
    });

    const updated = await prisma.submission.update({
      where: { id: sub.id },
      data: {
        aiScore: aiData.score,
        aiFeedback: aiFeedbackStr,
        readingStrategy: aiData.readingStrategy,
        rubricData: JSON.stringify(aiData.rubricScores || []),
        skillScores: JSON.stringify(aiData.skillScores),
        status: 'PENDING',
        gradedAt: new Date()
      },
      // The HITL workspace re-renders from this payload — without the relations
      // it loses activity.points (score denominator) and activity.classId
      // (the "Done" button's link back to the class roster).
      include: { student: true, activity: { include: { class: true } } }
    });

    res.json({ success: true, submission: updated });
  } catch (e) {
    console.error('Analyze error:', e);
    await prisma.submission.update({ where: { id: req.params.id }, data: { status: 'ERROR', aiFeedback: '? AI Error: ' + e.message } });
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/teacher/refine', async (req, res) => {
  try {
    const { currentFeedback, prompt: teacherPrompt, isStructured } = req.body;
    
    // Build prompt based on whether the feedback is structured
    let sys;
    if (isStructured) {
      sys = `You are an expert teaching assistant. Rewrite the following student feedback based on the teacher's instruction. Keep the tone warm and encouraging.

Original Feedback:
${currentFeedback}

Teacher's Instruction: ${teacherPrompt}

Return ONLY a valid JSON object matching this schema exactly:
{
  "strengths": "<rewritten strengths text>",
  "areasForGrowth": [
    { "studentQuote": "<exact quote>", "explanation": "<rewritten explanation>" }
  ],
  "actionableSteps": ["<rewritten step 1>", "<rewritten step 2>"]
}`;
    } else {
      sys = `You are an expert teaching assistant. Rewrite the following student feedback based on the teacher's instruction. Keep the tone warm and encouraging.
Return ONLY the rewritten feedback text — no markdown, no quotes, no conversational filler.

Original Feedback:
"${currentFeedback}"

Teacher's Instruction: ${teacherPrompt}`;
    }

    let refinedFeedback = currentFeedback; // fallback: return unchanged
    if (chatModel) {
      try {
        const result = await chatModel.generateContent({
          contents: [{ role: 'user', parts: [{ text: sys }] }],
          generationConfig: isStructured ? { responseMimeType: "application/json" } : undefined
        });
        let text = result.response.text().trim();
        // Clean markdown code blocks just in case
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        refinedFeedback = text;
      } catch (e) {
        console.log('⚠ AI refine failed:', e.message?.slice(0, 80));
        // refinedFeedback stays as the original currentFeedback
      }
    }
    res.json({ success: true, refinedFeedback, isStructured: !!isStructured });
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
      data: { hitlScore: parseInt(hitlScore), hitlFeedback, readingStrategy, rubricData: JSON.stringify(rubricData), status: 'GRADED', gradedAt: new Date() },
      include: { student: true, activity: { include: { class: true } } }
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
    const classIds = classes.map(c => c.id);
    const SKILLS = ['vocabulary', 'punctuation', 'thematicFlow', 'sentenceStructure'];

    // Every graded submission across these classes, fetched once rather than
    // per student — the old version issued one query per student.
    const graded = await prisma.submission.findMany({
      where: { status: 'GRADED', activity: { classId: { in: classIds } } },
      orderBy: { createdAt: 'asc' },
      include: { activity: { select: { id: true, title: true, type: true, points: true, classId: true } } }
    });

    const byStudent = new Map();
    for (const s of graded) {
      if (!byStudent.has(s.studentId)) byStudent.set(s.studentId, []);
      byStudent.get(s.studentId).push(s);
    }

    // ── Per-activity breakdown, in the activity's own points ──
    const activityMap = new Map();
    for (const s of graded) {
      const a = s.activity;
      if (!a) continue;
      if (!activityMap.has(a.id)) {
        activityMap.set(a.id, { id: a.id, title: a.title, type: a.type, points: a.points || 100, percents: [] });
      }
      activityMap.get(a.id).percents.push(s.hitlScore ?? s.aiScore ?? 0);
    }
    const activityBreakdown = [...activityMap.values()].map(a => {
      const avgPercent = Math.round(a.percents.reduce((x, y) => x + y, 0) / a.percents.length);
      return {
        id: a.id, title: a.title, type: a.type,
        points: a.points,
        gradedCount: a.percents.length,
        avgPercent,
        // The number a teacher actually writes in a record book.
        avgPoints: Math.round((avgPercent / 100) * a.points * 10) / 10,
        lowest: Math.min(...a.percents),
        highest: Math.max(...a.percents)
      };
    }).sort((a, b) => a.avgPercent - b.avgPercent);

    // ── Per-student summary ──
    const studentTrends = [];
    const needsSupport = [];

    for (const student of uniqueStudents) {
      const subs = byStudent.get(student.id) || [];
      if (subs.length === 0) {
        studentTrends.push({ student, gradedCount: 0, avgPercent: null, pointsEarned: 0, pointsPossible: 0, latest: null, skillScores: {}, history: [] });
        continue;
      }

      const percents = subs.map(s => s.hitlScore ?? s.aiScore ?? 0);
      const pointsEarned = subs.reduce((sum, s) => sum + ((s.hitlScore ?? s.aiScore ?? 0) / 100) * (s.activity?.points || 100), 0);
      const pointsPossible = subs.reduce((sum, s) => sum + (s.activity?.points || 100), 0);
      const avgPercent = Math.round(percents.reduce((a, b) => a + b, 0) / percents.length);

      const skillHistory = subs
        .filter(s => s.skillScores)
        .map(s => { try { return JSON.parse(s.skillScores); } catch { return null; } })
        .filter(Boolean);
      const latestSkills = skillHistory[skillHistory.length - 1] || {};

      const last = subs[subs.length - 1];
      const latestPercent = last.hitlScore ?? last.aiScore ?? 0;

      studentTrends.push({
        student,
        gradedCount: subs.length,
        avgPercent,
        pointsEarned: Math.round(pointsEarned),
        pointsPossible,
        latest: {
          activityTitle: last.activity?.title || '',
          percent: latestPercent,
          points: Math.round((latestPercent / 100) * (last.activity?.points || 100) * 10) / 10,
          totalPoints: last.activity?.points || 100
        },
        skillScores: latestSkills,
        history: percents.slice(-5)
      });

      // ── Who could use a hand? Stated as encouragement, not alarm. ──
      const reasons = [];
      if (avgPercent < 75) {
        reasons.push({ kind: 'average', label: `Averaging ${avgPercent}% so far`, detail: 'A short check-in could help.' });
      }
      if (percents.length >= 3) {
        const recent = percents.slice(-3);
        if (recent[2] < recent[1] && recent[1] < recent[0]) {
          reasons.push({
            kind: 'trend',
            label: `Scores easing down (${recent.join('% → ')}%)`,
            detail: 'Three activities in a row have dipped.'
          });
        }
      }
      for (const skill of SKILLS) {
        const vals = skillHistory.map(h => h[skill]).filter(v => typeof v === 'number' && v > 0);
        if (vals.length >= 3) {
          const recent = vals.slice(-3);
          if (recent[2] < recent[1] && recent[1] < recent[0]) {
            reasons.push({ kind: 'skill', skill, label: `${skill} slipping`, trend: recent });
          }
        }
      }
      if (reasons.length) needsSupport.push({ student, avgPercent, reasons });
    }

    // Lowest averages first — that's who to look at.
    needsSupport.sort((a, b) => (a.avgPercent ?? 100) - (b.avgPercent ?? 100));
    studentTrends.sort((a, b) => (b.avgPercent ?? -1) - (a.avgPercent ?? -1));

    // ── Class-level headline numbers ──
    const scored = studentTrends.filter(s => s.avgPercent !== null);
    const classAverage = scored.length
      ? Math.round(scored.reduce((sum, s) => sum + s.avgPercent, 0) / scored.length)
      : null;
    const totalEarned = studentTrends.reduce((sum, s) => sum + s.pointsEarned, 0);
    const totalPossible = studentTrends.reduce((sum, s) => sum + s.pointsPossible, 0);

    const classAvgSkills = {};
    SKILLS.forEach(skill => {
      const vals = studentTrends.map(st => st.skillScores?.[skill] || 0).filter(v => v > 0);
      classAvgSkills[skill] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    });

    // How the class is spread, for an at-a-glance bar.
    const bands = { excellent: 0, good: 0, fair: 0, needsWork: 0, notGraded: 0 };
    studentTrends.forEach(s => {
      if (s.avgPercent === null) bands.notGraded++;
      else if (s.avgPercent >= 90) bands.excellent++;
      else if (s.avgPercent >= 80) bands.good++;
      else if (s.avgPercent >= 75) bands.fair++;
      else bands.needsWork++;
    });

    const allSections = classes.reduce((acc, c) => {
      if (c.section && !acc.find(s => s.id === c.section.id)) {
        acc.push({ id: c.section.id, name: c.section.name, studentCount: c.section.students?.length || 0 });
      }
      return acc;
    }, []);

    res.json({
      success: true,
      summary: {
        studentCount: uniqueStudents.length,
        gradedCount: graded.length,
        classAverage,
        pointsEarned: Math.round(totalEarned),
        pointsPossible: totalPossible,
        bands
      },
      activityBreakdown,
      studentTrends,
      needsSupport,
      classAvgSkills,
      sections: allSections
    });
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
      },
      include: { class: { select: { id: true, name: true } } }
    });
    const pendingSubmissions = await prisma.submission.findMany({
      where: { studentId: req.params.studentId, status: 'PENDING' },
      include: { activity: { include: { class: true } } },
      orderBy: { updatedAt: 'desc' }
    });

    const now = new Date();
    // Exclude activities the student has already submitted (both GRADED and PENDING)
    const submittedActivityIds = [
      ...submissions.map(s => s.activityId),
      ...pendingSubmissions.map(s => s.activityId)
    ];
    
    const upcomingDeadlines = upcomingActivities.filter(a => {
      if (submittedActivityIds.includes(a.id)) return false;
      const deadlineDate = new Date(a.deadline);
      return deadlineDate >= now || isNaN(deadlineDate); // Include if valid future date or format that doesn't parse to past
    }).map(a => ({
      id: a.id,
      title: a.title,
      deadline: a.deadline,
      points: a.points || 100,
      type: a.type || 'Essay',
      className: a.class?.name || '',
      classId: a.class?.id || '',
      submissionMode: a.submissionMode || 'TEACHER_UPLOAD',
      maxAttempts: a.maxAttempts ?? 1
    })).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

    res.json({ success: true, student, submissions, pendingSubmissions, avgGrade, stars, avgSkills, latestStrategy, upcomingDeadlines });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// SKILL PROGRESS (rubric-criterion-based, curriculum-aligned 4-skill mastery over time)
// ─────────────────────────────────────────
// Shared by the per-student and per-section skill-progress endpoints: takes a
// flat list of GRADED submissions (each with rubricData + activity.rubric /
// activity.classLesson.defaultRubric included) and computes the curriculum-
// aligned 4-skill cumulative mastery timeline described in skillTaxonomy.js.
function computeSkillProgress(submissions) {
  // Sort by best-available grading timestamp (gradedAt, falling back to updatedAt for legacy rows)
  // and drop submissions with no scorable rubric data (e.g. legacy non-array
  // rubricData shapes) — otherwise they'd occupy an empty point on the
  // timeline, pushing all real data (and the start of the chart) to the right.
  function hasScorableRubric(sub) {
    try {
      const parsed = JSON.parse(sub.rubricData);
      return Array.isArray(parsed) && parsed.some(entry => entry && typeof entry.score === 'number' && entry.maxPoints);
    } catch {
      return false;
    }
  }
  const withTimestamp = submissions
    .filter(hasScorableRubric)
    .map(s => ({ sub: s, ts: s.gradedAt || s.updatedAt }))
    .filter(x => x.ts)
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));

  if (!withTimestamp.length) {
    return { hasData: false, weeks: [], series: {} };
  }

  // Resolve each activity's rubric criteria name -> description map (cached per activity's rubric JSON)
  const criteriaMapCache = new Map();
  function getCriteriaMap(activity) {
    const source = activity.rubric || activity.classLesson?.defaultRubric;
    if (!source) return {};
    if (criteriaMapCache.has(source)) return criteriaMapCache.get(source);
    let map = {};
    try {
      const parsed = JSON.parse(source);
      const criteria = Array.isArray(parsed) ? parsed : (parsed.criteria || []);
      for (const c of criteria) {
        if (c?.name) map[c.name] = c.description || '';
      }
    } catch { }
    criteriaMapCache.set(source, map);
    return map;
  }

  // Decide bucketing mode. Weekly buckets are anchored to the first graded
  // submission and relabeled 1,2,3... so breaks/inactivity don't stretch the
  // chart — but if everything so far falls inside that first window, weekly
  // mode collapses to a single point (a dot, no line). So: bucket per-activity
  // until the graded history actually spreads across a few distinct weeks,
  // then switch to the coarser weekly rollup for a cleaner long-term trend.
  const firstTs = new Date(withTimestamp[0].ts).getTime();
  const MS_WEEK = 7 * 24 * 60 * 60 * 1000;
  const rawWeekOf = ts => Math.floor((new Date(ts).getTime() - firstTs) / MS_WEEK);
  const distinctRawWeeks = [...new Set(withTimestamp.map(x => rawWeekOf(x.ts)))].sort((a, b) => a - b);
  const WEEKLY_MODE_MIN_WEEKS = 4;
  const mode = distinctRawWeeks.length >= WEEKLY_MODE_MIN_WEEKS ? 'week' : 'activity';

  const skillIds = SKILLS.map(s => s.id);
  const running = {};
  skillIds.forEach(id => { running[id] = { sum: 0, max: 0 }; });
  const series = {};
  skillIds.forEach(id => { series[id] = []; });
  const points = [];

  function accumulate(sub) {
    const criteriaMap = sub.activity ? getCriteriaMap(sub.activity) : {};
    let rubricScores = [];
    try {
      const parsed = JSON.parse(sub.rubricData);
      if (Array.isArray(parsed)) rubricScores = parsed;
    } catch { }
    for (const entry of rubricScores) {
      if (!entry || typeof entry.score !== 'number' || !entry.maxPoints) continue;
      const description = criteriaMap[entry.criterionName] || '';
      const skillId = classifyCriterion(entry.criterionName, description);
      running[skillId].sum += entry.score;
      running[skillId].max += entry.maxPoints;
    }
  }

  function snapshot(pointIdx, label) {
    points.push({ week: pointIdx, label });
    skillIds.forEach(id => {
      const { sum, max } = running[id];
      series[id].push({ week: pointIdx, pct: max > 0 ? Math.round((sum / max) * 100) : null });
    });
  }

  if (mode === 'week') {
    const weekIndexMap = new Map(distinctRawWeeks.map((rw, i) => [rw, i + 1]));
    let currentWeekIdx = null;
    for (const { sub, ts } of withTimestamp) {
      const weekIdx = weekIndexMap.get(rawWeekOf(ts));
      if (currentWeekIdx !== null && weekIdx !== currentWeekIdx) {
        snapshot(currentWeekIdx, `Week ${currentWeekIdx}`);
      }
      currentWeekIdx = weekIdx;
      accumulate(sub);
    }
    if (currentWeekIdx !== null) snapshot(currentWeekIdx, `Week ${currentWeekIdx}`);
  } else {
    withTimestamp.forEach(({ sub, ts }, i) => {
      accumulate(sub);
      const label = new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
      snapshot(i + 1, label);
    });
  }

  return { hasData: true, mode, weeks: points, series };
}

const SKILL_PROGRESS_ACTIVITY_SELECT = {
  rubric: true,
  classLessonId: true,
  classLesson: { select: { defaultRubric: true } }
};

app.get('/api/student/:studentId/skill-progress', async (req, res) => {
  try {
    const submissions = await prisma.submission.findMany({
      where: { studentId: req.params.studentId, status: 'GRADED', rubricData: { not: null } },
      include: { activity: { select: SKILL_PROGRESS_ACTIVITY_SELECT } }
    });
    const result = computeSkillProgress(submissions);
    res.json({ success: true, skills: SKILLS, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Section-wide version — pools every student in the section's graded work
// into one shared timeline, for the Predictive Analytics per-section view.
app.get('/api/teacher/:teacherId/section/:sectionId/skill-progress', async (req, res) => {
  try {
    const { teacherId, sectionId } = req.params;
    const submissions = await prisma.submission.findMany({
      where: {
        status: 'GRADED',
        rubricData: { not: null },
        student: { sectionId },
        activity: { class: { teacherId, sectionId } }
      },
      include: { activity: { select: SKILL_PROGRESS_ACTIVITY_SELECT } }
    });
    const result = computeSkillProgress(submissions);
    res.json({ success: true, skills: SKILLS, ...result });
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
    // Always scope to the requesting teacher. Filtering by classId alone let a
    // teacher read any class's grades by id — including one reassigned away.
    const whereClause = classId
      ? { classId, class: { teacherId: req.params.teacherId } }
      : { class: { teacherId: req.params.teacherId } };
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

// Per-student, all-activities grade report (used by the Gradebook "click a
// student name" drill-down). Unlike the endpoint above, this starts from
// every activity assigned to the student's section — not just ones they've
// already submitted — so unsubmitted activities show up as Missing/Upcoming.
app.get('/api/teacher/:teacherId/student/:studentId/gradebook', async (req, res) => {
  try {
    const { teacherId, studentId } = req.params;
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, username: true, sectionId: true }
    });
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' });

    const activities = await prisma.activity.findMany({
      where: { class: { teacherId, sectionId: student.sectionId } },
      include: {
        class: { select: { name: true } },
        submissions: {
          where: { studentId },
          select: { id: true, hitlScore: true, aiScore: true, status: true, createdAt: true }
        }
      },
      orderBy: { deadline: 'asc' }
    });

    const now = new Date();
    const rows = activities.map(a => {
      const sub = a.submissions[0] || null;
      const deadline = a.deadline ? new Date(a.deadline) : null;

      let status;
      if (sub) {
        status = (deadline && sub.createdAt > deadline) ? 'LATE' : 'DONE';
      } else if (deadline && deadline < now) {
        status = 'MISSING';
      } else {
        status = 'UPCOMING';
      }

      const percentage = sub ? (sub.hitlScore ?? sub.aiScore ?? null) : null;
      const grade = percentage !== null ? Math.round((percentage / 100) * (a.points || 100)) : null;

      return {
        activityId: a.id,
        activityTitle: a.title,
        className: a.class?.name || '',
        deadline: a.deadline,
        status,
        grade,
        totalScore: a.points || 100,
        submissionId: sub?.id || null
      };
    });

    res.json({ success: true, student, rows });
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
      select: { activityId: true, status: true, id: true, imageUrl: true, attemptCount: true, updatedAt: true, hitlScore: true }
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

// Every class the student's section is enrolled in, with that student's own
// activities, scores and feedback. Backs the student Subjects / Activities /
// Gradebook pages.
app.get('/api/student/:studentId/subjects', async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      include: {
        section: {
          include: {
            classes: {
              include: {
                teacher: { select: { name: true } },
                activities: { orderBy: { createdAt: 'desc' } }
              }
            }
          }
        }
      }
    });

    const mySubmissions = await prisma.submission.findMany({
      where: { studentId },
      select: {
        id: true, activityId: true, status: true, hitlScore: true, aiScore: true,
        hitlFeedback: true, aiFeedback: true, updatedAt: true
      }
    });
    const submissionByActivity = {};
    mySubmissions.forEach(s => { submissionByActivity[s.activityId] = s; });

    // Feedback is stored as either a JSON blob or plain text — surface a short
    // human-readable line either way.
    const feedbackSummary = (sub) => {
      const raw = sub.hitlFeedback || sub.aiFeedback;
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed.strengths || null;
      } catch {
        return raw;
      }
    };

    const subjects = (student?.section?.classes || []).map(cls => {
      const activities = cls.activities.map(a => {
        const sub = submissionByActivity[a.id];
        let submission = null;
        if (sub) {
          const percent = sub.hitlScore ?? sub.aiScore ?? null;
          submission = {
            id: sub.id,
            status: sub.status,
            // Released to the student only once the teacher has validated it
            score: sub.status === 'GRADED' && percent !== null
              ? Math.round((percent / 100) * (a.points || 100))
              : null,
            percent: sub.status === 'GRADED' ? percent : null,
            feedback: sub.status === 'GRADED' ? feedbackSummary(sub) : null,
            updatedAt: sub.updatedAt
          };
        }
        return {
          id: a.id,
          title: a.title,
          type: a.type || 'Activity',
          points: a.points || 100,
          deadline: a.deadline,
          submissionMode: a.submissionMode,
          submission
        };
      });

      const gradedPercents = activities
        .map(a => a.submission?.percent)
        .filter(p => p !== null && p !== undefined);

      return {
        id: cls.id,
        name: cls.name,
        subject: cls.subject,
        gradeLevel: cls.gradeLevel,
        schoolYear: cls.schoolYear,
        teacherName: cls.teacher?.name || '',
        activityCount: activities.length,
        gradedCount: gradedPercents.length,
        overallGrade: gradedPercents.length
          ? Math.round(gradedPercents.reduce((a, b) => a + b, 0) / gradedPercents.length)
          : null,
        activities
      };
    });

    res.json({ success: true, subjects });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Single activity as seen by a student — used by the read-only detail page for
// TEACHER_UPLOAD activities, which the student cannot submit to themselves.
app.get('/api/student/:studentId/activities/:activityId', async (req, res) => {
  try {
    const { studentId, activityId } = req.params;
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      include: { class: { select: { id: true, name: true, subject: true } } }
    });
    if (!activity) return res.status(404).json({ success: false, error: 'Activity not found' });

    const mySubmission = await prisma.submission.findFirst({
      where: { studentId, activityId },
      select: { id: true, status: true, imageUrl: true, hitlScore: true, aiScore: true, attemptCount: true, updatedAt: true }
    });

    res.json({
      success: true,
      activity: { ...activity, className: activity.class?.name || '', mySubmission: mySubmission || null }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Student self-submission — stores image only, NO AI grading (teacher triggers AI via HITL)
app.post('/api/student/submit', upload.array('images', 20), async (req, res) => {
  try {
    const { studentId, activityId } = req.body;
    const imageFiles = req.files;
    if (!imageFiles || imageFiles.length === 0) return res.status(400).json({ error: 'No image provided' });
    
    const combined = await stitchPages(imageFiles);
    const finalImageUrl = await uploadToCloud(combined.path, combined.filename, {
      contentType: combined.isStitched ? 'image/jpeg' : (imageFiles[0].mimetype || 'image/jpeg')
    });

    // Check for existing submission and update, or create new
    const existing = await prisma.submission.findFirst({ where: { studentId, activityId } });
    const activity = await prisma.activity.findUnique({ where: { id: activityId }, select: { maxAttempts: true, deadline: true } });
    // 0 means unlimited re-submissions.
    const maxAttempts = activity?.maxAttempts ?? 1;
    let submission;
    if (existing) {
      // Block resubmission if already graded by teacher
      if (existing.hitlScore !== null || existing.status === 'GRADED') {
        return res.status(400).json({ success: false, error: 'This submission has already been graded by your teacher. Resubmission is no longer allowed.' });
      }
      // Block if deadline has passed
      if (activity?.deadline && new Date(activity.deadline) < new Date()) {
        return res.status(400).json({ success: false, error: 'The deadline for this activity has passed. Resubmission is no longer allowed.' });
      }
      // Block if max attempts reached
      if (maxAttempts !== 0 && existing.attemptCount >= maxAttempts) {
        return res.status(400).json({ success: false, error: `You have used all ${maxAttempts} attempt(s) for this activity.` });
      }
      submission = await prisma.submission.update({
        where: { id: existing.id },
        data: { imageUrl: finalImageUrl, status: 'PENDING', aiScore: null, hitlScore: null, aiFeedback: null, hitlFeedback: null, attemptCount: existing.attemptCount + 1 }
      });
    } else {
      submission = await prisma.submission.create({
        data: { studentId, activityId, imageUrl: finalImageUrl, status: 'PENDING', attemptCount: 1 }
      });
    }
    
    res.json({ success: true, submission });
  } catch (e) {
    if (req.files) req.files.forEach(f => { try { fs.unlinkSync(f.path) } catch {} });
    res.status(500).json({ success: false, error: e.message });
  }
});

// Accepts a single page as `image` (legacy / offline queue) or multiple pages as `images`.
app.post('/api/teacher/upload', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'images', maxCount: 20 }]), async (req, res) => {
  try {
    const { studentId, activityId, skipGrading } = req.body;
    const imageFiles = [...(req.files?.images || []), ...(req.files?.image || [])];
    if (imageFiles.length === 0) return res.status(400).json({ error: 'No image provided' });
    // Require a real student to be assigned before AI grading
    if (!studentId || studentId === 'mock-student-id') {
      return res.status(400).json({ success: false, error: 'Please assign a student before grading. A student must be selected.' });
    }

    // 1) Stitch multi-page outputs into one image, then preprocess it
    const combined = await stitchPages(imageFiles);
    const processedPath = await preprocessImage(combined.path);
    const processedFilename = path.basename(processedPath);
    // Upload to Supabase Storage in production, local path in dev
    const processedUrl = await uploadToCloud(processedPath, processedFilename);

    let submissionData;
    if (skipGrading === 'true') {
      // Store the image only — grading happens later, on demand, via
      // POST /api/teacher/submissions/:id/analyze (see the "Ready for AI
      // Checking" flow in HITLWorkspace). Explicitly null out any prior
      // grading result in case this is a replacement photo.
      submissionData = {
        imageUrl: processedUrl,
        status: 'PENDING',
        aiScore: null,
        aiFeedback: null,
        rubricData: null,
        skillScores: null,
        gradedAt: null
      };
    } else {
      // 2) Call the shared AI grading function
      const aiData = await generateSubmissionFeedback(processedPath, activityId, studentId);
      const aiFeedbackStr = JSON.stringify({
        strengths: aiData.strengths,
        areasForGrowth: aiData.areasForGrowth,
        actionableSteps: aiData.actionableSteps
      });
      submissionData = {
        imageUrl: processedUrl,
        aiScore: aiData.score,
        aiFeedback: aiFeedbackStr,
        readingStrategy: aiData.readingStrategy,
        rubricData: JSON.stringify(aiData.rubricScores || []),
        skillScores: JSON.stringify(aiData.skillScores),
        status: 'PENDING',
        gradedAt: new Date()
      };
    }

    // Check for existing submission
    const existing = await prisma.submission.findFirst({ where: { studentId, activityId } });
    let submission;
    if (existing) {
      submission = await prisma.submission.update({ where: { id: existing.id }, data: submissionData });
    } else {
      submission = await prisma.submission.create({ data: { studentId, activityId, ...submissionData } });
    }

res.json({ success: true, submission });
  } catch (e) {
    // Auto-delete uploaded files on failure
    try {
      Object.values(req.files || {}).flat().forEach(f => {
        try { fs.unlinkSync(f.path); } catch {}
      });
    } catch {}
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
    if (!chatModel) {
      reply = "AI tutoring is currently unavailable. Please try again shortly.";
    } else {
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

    const [teacherPassword, studentPassword] = await Promise.all([
      bcrypt.hash('password', BCRYPT_SALT_ROUNDS),
      bcrypt.hash('password123', BCRYPT_SALT_ROUNDS)
    ]);
    const teacher = await prisma.user.create({
      data: { name: 'Maria Clara', username: 'maria@school.edu.ph', email: 'maria@school.edu.ph', password: teacherPassword, role: 'TEACHER', schoolName: 'Manila Science HS' }
    });
    const section = await prisma.section.create({ data: { name: 'Grade 10 - Rizal', teacherId: teacher.id } });
    const student = await prisma.user.create({
      data: { name: 'Juan Dela Cruz', username: 'RIZAL-001', password: studentPassword, role: 'STUDENT', sectionId: section.id }
    });
    const student2 = await prisma.user.create({
      data: { name: 'Maria Santos', username: 'RIZAL-002', password: studentPassword, role: 'STUDENT', sectionId: section.id }
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

app.get('/api/rubric-templates/builtin', (req, res) => {
  const templates = getAllRubricTemplates();
  res.json({ success: true, templates });
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

    // Topic mastery: group by activity topic.
    //
    // hitlScore/aiScore are stored as PERCENTAGES (0-100) — the rubric criteria
    // always sum to 100. Points earned is therefore percent × activity.points.
    // The old code divided the percentage by the point total, which produced
    // nonsense like 142% for 85% on a 60-point activity.
    const topicMap = {};
    for (const sub of submissions) {
      const topic = sub.activity?.topic || sub.activity?.title;
      if (!topic) continue;
      if (!topicMap[topic]) topicMap[topic] = { percents: [], earned: 0, possible: 0 };
      const percent = sub.hitlScore ?? sub.aiScore ?? 0;
      const points = sub.activity?.points || 100;
      topicMap[topic].percents.push(percent);
      topicMap[topic].earned += (percent / 100) * points;
      topicMap[topic].possible += points;
    }

    const topicMastery = Object.entries(topicMap).map(([topicId, data]) => {
      const avgPercentage = Math.round(data.percents.reduce((a, b) => a + b, 0) / data.percents.length);
      const topicInfo = getTopicById(topicId);
      return {
        topicId,
        topicName: topicInfo?.name || topicId,
        term: topicInfo?.term || null,
        avgPercentage,
        pointsEarned: Math.round(data.earned),
        pointsPossible: data.possible,
        count: data.percents.length
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

    // Determine which classes to export — always confirming this teacher owns
    // them, so a class reassigned away can't still be exported by its old owner.
    let classIds = [];
    if (classId) {
      const owned = await prisma.class.findFirst({ where: { id: classId, teacherId }, select: { id: true } });
      if (!owned) return res.status(404).json({ success: false, error: 'Class not found for this teacher.' });
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

app.post('/api/admin/archive-grades', async (req, res) => {
  try {
    const now = new Date();
    const result = await prisma.submission.updateMany({
      where: {
        retainUntil: { lte: now },
        archivedAt: null
      },
      data: { archivedAt: now }
    });
    res.json({ success: true, archivedCount: result.count });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/admin/purge-grades', async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const result = await prisma.submission.deleteMany({
      where: {
        archivedAt: { not: null },
        retainUntil: { lte: thirtyDaysAgo }
      }
    });
    res.json({ success: true, purgedCount: result.count });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(port, () => {
  console.log(`TulongGuro API running on port ${port}`);
  verifyStorage();
});
