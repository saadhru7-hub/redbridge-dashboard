// Netlify Function — secure server-side proxy to Gemini API (Google AI)
// The API key lives ONLY in Netlify's environment variables, never in
// the front-end code, so it can never be seen by anyone visiting the site.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server is not configured with an API key yet.' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { messages, system } = payload;
  if (!messages || !Array.isArray(messages)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'messages array is required' }) };
  }

  // Gemini uses "contents" with role 'user'/'model' (not 'assistant'),
  // and a separate systemInstruction field instead of a system message.
  const contents = messages.map(function (m) {
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    };
  });

  const requestBody = {
    contents: contents,
    generationConfig: { maxOutputTokens: 2000, temperature: 0.7 }
  };
  if (system) {
    requestBody.systemInstruction = { parts: [{ text: system }] };
  }

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: (data.error && data.error.message) ? data.error.message : 'Gemini API error' })
      };
    }

    const candidate = data.candidates && data.candidates[0];
    const reply = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0]
      ? candidate.content.parts[0].text
      : 'No response generated.';

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: reply })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to reach AI service: ' + err.message })
    };
  }
};
