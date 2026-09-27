const express = require('express');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = 3000;

// Body parsing with 50MB limit for scanned PDFs and image attachments
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Initialize GoogleGenAI client (automatically loads process.env.GEMINI_API_KEY)
const ai = new GoogleGenAI();

// AI HR Document Analysis API endpoint using gemini-3.8-flash
app.post('/api/hr-docs/analyze', async (req, res) => {
  try {
    const { base64, mimeType, fileName } = req.body || {};
    if (!base64) {
      return res.status(400).json({ success: false, error: 'Document file data missing' });
    }

    const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
    let cleanMimeType = mimeType || 'application/pdf';
    if (fileName) {
      const ext = fileName.split('.').pop().toLowerCase();
      if (['jpg', 'jpeg'].includes(ext)) cleanMimeType = 'image/jpeg';
      else if (ext === 'png') cleanMimeType = 'image/png';
      else if (ext === 'webp') cleanMimeType = 'image/webp';
      else if (ext === 'pdf') cleanMimeType = 'application/pdf';
    }

    const prompt = `You are an expert HR, Legal Compliance, and Statutory Document Analyst for Arora Textiles Private Limited (ATPL).
Analyze this uploaded document (PDF or scanned image) with 100% precision.
Extract and identify the following fields:
1. document_name: Exact official title (e.g., 'Fire NOC / Fire Safety Certificate', 'Factory Inspectorate License Renewal', 'First Aid Training Certificate', 'Standing Orders', 'POSH Policy', 'ESI / PF Statutory Return', 'Pollution Control Board Consent').
2. doc_type: Must be one of: 'Legal / Compliance', 'Certificate / License', 'Training Record', 'HR Policy', 'Fire NOC', or 'Other'.
3. holder: Company name or individual holder mentioned (e.g. 'Arora Textiles Private Limited', or Employee Name).
4. reference_no: Application, acknowledgment, or file reference number (e.g. 'LSG/BIKANER/FIRENOC/2024-25/34493').
5. certificate_no: Certificate, registration, or license number if distinct.
6. issuing_authority: Department, Council, Municipal Corporation, Inspectorate, or training agency (e.g., 'Municipal Corporation Bikaner / Fire Department', 'Directorate of Factories and Boilers').
7. issue_date: Date of issue / training in YYYY-MM-DD format. If none, return empty string.
8. expiry_date: Expiration / validity date in YYYY-MM-DD format. If permanent or no expiry, return empty string.
9. retraining_date: Next re-training or renewal due date in YYYY-MM-DD format.
10. validity_period: Duration mentioned (e.g., '1 Year', '3 Years', 'Permanent', 'Annual').
11. location: Factory / Unit / Site / Department mentioned (e.g. 'Bikaner Unit / Weaving Section').
12. remarks: Concise summary of key details, trainer name, employee ID if applicable, or conditions.

Return strictly valid JSON matching the schema.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          inlineData: {
            mimeType: cleanMimeType,
            data: cleanBase64
          }
        },
        prompt
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            document_name: { type: 'STRING' },
            doc_type: { type: 'STRING' },
            holder: { type: 'STRING' },
            reference_no: { type: 'STRING' },
            certificate_no: { type: 'STRING' },
            issuing_authority: { type: 'STRING' },
            issue_date: { type: 'STRING' },
            expiry_date: { type: 'STRING' },
            retraining_date: { type: 'STRING' },
            validity_period: { type: 'STRING' },
            location: { type: 'STRING' },
            remarks: { type: 'STRING' }
          },
          required: ['document_name', 'doc_type']
        }
      }
    });

    const parsed = JSON.parse(response.text);
    return res.json({ success: true, data: parsed });
  } catch (err) {
    console.error('Gemini HR doc analysis error:', err);
    return res.status(500).json({ success: false, error: err.message || 'AI document analysis failed' });
  }
});

// Serve all static assets from root project directory
app.use(express.static(__dirname, {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (filePath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
  }
}));

// Route fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
