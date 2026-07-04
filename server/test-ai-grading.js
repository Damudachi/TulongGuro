const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const SAMPLES_DIR = path.join(__dirname, 'test-samples');

async function testHandwritingEvaluation(imagePath, topicId) {
  console.log(`\nTesting image: ${path.basename(imagePath)}`);
  
  if (!fs.existsSync(imagePath)) {
    console.error(`File not found: ${imagePath}`);
    return;
  }

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: 'You are an expert Grade 6 English teacher evaluating handwritten essays. Output strict JSON.'
    });

    const imageData = fs.readFileSync(imagePath);
    const imagePart = {
      inlineData: {
        data: imageData.toString('base64'),
        mimeType: 'image/jpeg'
      }
    };

    const prompt = `
      Evaluate this handwritten essay.
      Topic ID context: ${topicId || 'None'}
      
      First, check if the image contains readable handwritten text.
      If it does NOT, return: {"noTextDetected": true}
      
      If it does, evaluate it and return JSON:
      {
        "score": number (0-100),
        "contentScore": number,
        "organizationScore": number,
        "grammarScore": number,
        "feedback": "constructive feedback",
        "readingStrategy": "suggested reading strategy",
        "skillScores": {"vocabulary": 1-25, "punctuation": 1-25, "thematicFlow": 1-25, "sentenceStructure": 1-25}
      }
    `;

    console.log('Sending to Gemini 2.5 Flash...');
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();
    
    // Clean up markdown code blocks if present
    const cleanedText = text.replace(/```json\n?|\n?```/gi, '').trim();
    const parsed = JSON.parse(cleanedText);
    
    console.log('Result:');
    console.dir(parsed, { depth: null, colors: true });

  } catch (err) {
    console.error('Test failed:', err.message);
  }
}

async function runTests() {
  if (!fs.existsSync(SAMPLES_DIR)) {
    console.log(`Samples directory created at ${SAMPLES_DIR}. Add .jpg images and run again.`);
    fs.mkdirSync(SAMPLES_DIR, { recursive: true });
    return;
  }

  const files = fs.readdirSync(SAMPLES_DIR).filter(f => f.endsWith('.jpg') || f.endsWith('.png'));
  if (files.length === 0) {
    console.log(`No images found in ${SAMPLES_DIR}. Add .jpg/.png images to test.`);
    return;
  }

  for (const file of files) {
    await testHandwritingEvaluation(path.join(SAMPLES_DIR, file), 'q1-narrative-writing');
  }
}

runTests();
