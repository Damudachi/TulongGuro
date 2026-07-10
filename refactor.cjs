const fs = require('fs');
const path = require('path');

const serverPath = "c:\\TULONGGURO_JULY 5\\Tulongguro\\server\\server.js";
let code = fs.readFileSync(serverPath, 'utf-8');

const preprocessEnd = code.indexOf(`// 2) Fetch activity rubric context`);
const resJsonSuccess = code.indexOf(`res.json({ success: true, submission });`, preprocessEnd);

const aiBlock = code.slice(preprocessEnd, resJsonSuccess);

let newCode = code.replace(aiBlock, `
    // 2) Call the new shared AI grading function
    const aiData = await generateSubmissionFeedback(processedPath, activityId, studentId);
    
    // Check for privacy violation
    if (aiData.privacyViolationDetected) {
      return res.status(400).json({ success: false, error: 'Privacy Violation Detected: A student name was found written on the paper. For data privacy, please crop out or redact the name before uploading.' });
    }

    // 6) Save to DB
    const aiFeedbackStr = JSON.stringify({
      strengths: aiData.strengths,
      areasForGrowth: aiData.areasForGrowth,
      actionableSteps: aiData.actionableSteps
    });

    // Check for existing submission
    const existing = await prisma.submission.findFirst({ where: { studentId, activityId } });
    let submission;
    if (existing) {
      submission = await prisma.submission.update({
        where: { id: existing.id },
        data: {
          imageUrl: processedUrl,
          aiScore: aiData.score,
          aiFeedback: aiFeedbackStr,
          readingStrategy: aiData.readingStrategy,
          rubricData: JSON.stringify(aiData.rubricScores || []),
          skillScores: JSON.stringify(aiData.skillScores),
          privacyViolation: aiData.privacyViolationDetected,
          status: 'GRADED'
        }
      });
    } else {
      submission = await prisma.submission.create({
        data: {
          studentId,
          activityId,
          imageUrl: processedUrl,
          aiScore: aiData.score,
          aiFeedback: aiFeedbackStr,
          readingStrategy: aiData.readingStrategy,
          rubricData: JSON.stringify(aiData.rubricScores || []),
          skillScores: JSON.stringify(aiData.skillScores),
          privacyViolation: aiData.privacyViolationDetected,
          status: 'GRADED'
        }
      });
    }
    
`);

const functionDef = `
async function generateSubmissionFeedback(imagePath, activityId, studentId) {
${aiBlock
  .replace(/let aiResult = null;/g, 'let aiResult = null;')
  .replace(/\/\/ 6\) Save to DB[\s\S]+?(?=res\.json\({ success: true, submission }\);)/, `return aiResult;`)
  .replace(/\/\/ PRIVACY HARD-BLOCK[\s\S]+?(?=\/\/ 6\) Save to DB)/, `
    if (aiResult.privacyViolationDetected) {
      console.log('🛑 PRIVACY VIOLATION DETECTED: Rejected upload because a student name was found.');
      return { privacyViolationDetected: true };
    }
  `)
  .replace(/const imgBuffer = fs\.readFileSync\(processedPath\);/g, 'const imgBuffer = fs.readFileSync(imagePath);')
}
}

`;

newCode = newCode.replace(`app.post('/api/teacher/upload'`, functionDef + `app.post('/api/teacher/upload'`);

const newEndpoint = `
// Trigger AI grading on an existing PENDING submission
app.post('/api/teacher/submissions/:id/analyze', async (req, res) => {
  try {
    const sub = await prisma.submission.findUnique({ where: { id: req.params.id } });
    if (!sub) return res.status(404).json({ error: 'Submission not found' });
    if (sub.aiScore !== null) return res.status(400).json({ error: 'Already analyzed by AI' });

    // The imageUrl might be /uploads/something.jpg
    const imagePath = path.join(__dirname, sub.imageUrl);
    if (!fs.existsSync(imagePath)) return res.status(404).json({ error: 'Image file not found on server' });

    const aiData = await generateSubmissionFeedback(imagePath, sub.activityId, sub.studentId);

    if (aiData.privacyViolationDetected) {
      await prisma.submission.update({ where: { id: sub.id }, data: { privacyViolation: true, status: 'ERROR', aiFeedback: '? Privacy Violation: Student name detected on paper. AI grading aborted.' } });
      return res.status(400).json({ success: false, error: 'Privacy Violation Detected.' });
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
        status: 'GRADED'
      }
    });

    res.json({ success: true, submission: updated });
  } catch (e) {
    console.error('Analyze error:', e);
    await prisma.submission.update({ where: { id: req.params.id }, data: { status: 'ERROR', aiFeedback: '? AI Error: ' + e.message } });
    res.status(500).json({ success: false, error: e.message });
  }
});

`;

newCode = newCode.replace(`app.post('/api/teacher/refine'`, newEndpoint + `app.post('/api/teacher/refine'`);

fs.writeFileSync(serverPath, newCode);
console.log('Refactoring complete.');
