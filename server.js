const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const admin = require('firebase-admin');

const app = express();

app.use(cors({
    origin: ['https://garagemhw.web.app', 'http://127.0.0.1:5500'],
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '10mb' }));

// Firebase
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase conectado com sucesso!");
} catch (error) {
    console.log("Aguardando configuração da chave do Firebase...");
}

const db = admin.firestore();

// --- ROTAÇÃO DE CHAVES GEMINI ---
const GEMINI_KEYS = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
].filter(Boolean);

let keyIndex = 0;

function chamarGemini(chave, mimeType, base64Data) {
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${chave}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: "Você é um especialista em Hot Wheels. Olhe esta foto da cartela e identifique o nome do modelo. Responda APENAS com o nome curto do carro (ex: 'Nissan Skyline', 'Bone Shaker'). NÃO responda o código de lote. Seja exato, sem explicações, aspas ou descrições." },
                    { inline_data: { mime_type: mimeType, data: base64Data } }
                ]
            }],
            generationConfig: {
                temperature: 0.4,
                topK: 32,
                topP: 1,
                maxOutputTokens: 100,
            }
        })
    });
}

// Rota Mercado Pago
app.post('/checkout', async (req, res) => {
    try {
        const { pedidoId, valor, clienteId, lojaId } = req.body;

        const lojaDoc = await db.collection("lojas").doc(lojaId).get();
        if (!lojaDoc.exists) return res.status(404).json({ error: "Loja não encontrada." });

        const tokenLoja = lojaDoc.data().mpAccessToken;
        if (!tokenLoja) return res.status(400).json({ error: "Loja sem token do Mercado Pago." });

        const client = new MercadoPagoConfig({ accessToken: tokenLoja });
        const preference = new Preference(client);

        const response = await preference.create({
            body: {
                items: [{
                    id: pedidoId,
                    title: `Encomenda de Miniatura - ${lojaId}`,
                    quantity: 1,
                    unit_price: Number(valor),
                    currency_id: "BRL"
                }],
                external_reference: JSON.stringify({ pedidoId, clienteId, lojaId }),
                back_urls: {
                    success: "https://garagemhw.web.app/app.html?type=encomendas",
                    pending: "https://garagemhw.web.app/app.html?type=encomendas",
                    failure: "https://garagemhw.web.app/app.html?type=encomendas"
                },
                auto_return: "approved"
            }
        });

        return res.status(200).json({ init_point: response.init_point });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Rota IA com rotação automática de chaves
app.post('/scan-hotwheels', async (req, res) => {
    try {
        const { mimeType, imageBase64 } = req.body;
        const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

        if (GEMINI_KEYS.length === 0) {
            return res.status(500).json({ error: "Nenhuma chave Gemini configurada." });
        }

        let tentativas = 0;
        let data = null;

        while (tentativas < GEMINI_KEYS.length) {
            const chaveAtual = GEMINI_KEYS[keyIndex];
            console.log(`Tentativa ${tentativas + 1} com chave índice ${keyIndex}`);

            const response = await chamarGemini(chaveAtual, mimeType, base64Data);
            data = await response.json();

            if (data.error?.code === 429) {
                console.warn(`Chave ${keyIndex} com quota esgotada (429). Trocando...`);
                keyIndex = (keyIndex + 1) % GEMINI_KEYS.length;
                tentativas++;
            } else {
                break;
            }
        }

        if (data.error) {
            console.error("Erro do Gemini API:", JSON.stringify(data.error));
            return res.status(500).json({ error: data.error.message });
        }

        const carroIdentificado = data.candidates[0].content.parts[0].text.trim();
        res.status(200).json({ result: carroIdentificado });

    } catch (error) {
        console.error("Erro interno do servidor:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(process.env.PORT || 3000, () => console.log("Servidor Online!"));