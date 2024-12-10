const express = require('express');
const openai = require('openai');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(express.json());

// Enable CORS for all routes
app.use(cors());

// Replace with your OpenAI API key in Vercel settings
openai.apiKey = process.env.OPENAI_API_KEY;

app.post('/reply', async (req, res) => {
    const userMessage = req.body.message;
    if (!userMessage) {
        return res.status(400).json({ error: 'Message is required' });
    }

    try {
        const response = await openai.ChatCompletion.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: userMessage }],
        });
        res.json({ reply: response.choices[0].message.content });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
