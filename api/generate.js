module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY is not set on this server.' });

    let body;
    if (req.body && typeof req.body === 'object') {
      body = req.body;
    } else if (typeof req.body === 'string') {
      body = JSON.parse(req.body);
    } else {
      body = await new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk.toString(); });
        req.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error('Could not parse request body')); }
        });
        req.on('error', reject);
      });
    }

    const { fabricImage, shape, size, style, trim, trimColor } = body || {};
    if (!fabricImage) return res.status(400).json({ error: 'No fabric image provided.' });

    const base64Data = fabricImage.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    const prompt = buildPrompt(shape, size, style, trim, trimColor);

    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
    formData.append('image[]', blob, 'fabric.jpg');
    formData.append('prompt', prompt);
    formData.append('model', 'gpt-image-1');
    formData.append('n', '1');
    formData.append('size', '1024x1024');
    formData.append('quality', 'high');

    const genResp = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    });

    const genData = await genResp.json();
    if (!genResp.ok) {
      return res.status(500).json({ error: genData.error?.message || 'Image generation failed.' });
    }

    return res.status(200).json({
      image: genData.data[0],
      fabricDescription: 'Rendered directly from your fabric swatch image'
    });

  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: err.message || 'An unexpected server error occurred.' });
  }
};

function buildPrompt(shape, size, style, trim, trimColor) {
  const shapes = {
    square: `a plump, well-stuffed square throw pillow (${size} inches) with soft rounded corners and even fullness`,
    lumbar: `a plump rectangular lumbar throw pillow (${size} inches), wide and low-profile with gently rounded edges`,
    ball:   `a perfectly round spherical ball pillow (${size} diameter), smooth and evenly filled`,
    knot:   `an oversized decorative knotted pillow (${size} size), the fabric twisted and looped into a large sculptural hand-tied knot`
  };

  let trimDesc = '';
  if (trim && trim !== 'none') {
    const tc = trimColor ? ` in ${trimColor}` : '';
    const trimMap = {
      piping:  `finished with a tailored cord piping/welt trim${tc} sewn precisely along all seam edges`,
      fringe:  `adorned with flowing tassel fringe${tc} along all edges`,
      velvet:  `bordered with a wide velvet ribbon trim${tc} around the entire perimeter`,
      pompom:  `edged with evenly spaced small decorative pom-poms${tc} along all sides`
    };
    trimDesc = `, ${trimMap[trim] || ''}`;
  }

  const shapeDesc = shapes[shape] || shapes.square;

  return `Photorealistic commercial product photograph of ${shapeDesc}${trimDesc}. The pillow must be upholstered in the EXACT fabric shown in the reference image. Reproduce the precise colors, pattern, scale, weave texture, pile height, and surface sheen exactly as they appear in the fabric swatch — do not reinterpret, generalize, or substitute a different fabric. The pillow is plump and full with realistic fabric draping, natural fold shadows, and clean seam stitching. ${style}. Shot at a slight angle to show depth. Ultra-sharp focus on the fabric surface. Studio lighting, soft shadows, neutral background. 8K resolution, commercial interior product photography. No text, no labels, no people.`;
}
