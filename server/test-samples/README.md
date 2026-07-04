# Handwriting AI Grading Test Samples

This directory is intended to store samples of handwritten essays for testing the AI grading system's performance, specifically evaluating how well it handles different handwriting legibility, ink types, and lighting conditions.

## Recommended Test Cases to Gather:
1. **Clear Print** (Ballpoint pen, dark ink, white lined paper)
2. **Cursive Writing** (Legible, standard size)
3. **Faded Ink/Pencil** (To test OCR/VLM contrast limits)
4. **Poor Lighting** (Shadows across the page)
5. **Messy/Crossed Out Text** (To see how the VLM ignores crossed-out words)

To run tests against the grading endpoint, use the `test-ai-grading.js` script in the server directory.
