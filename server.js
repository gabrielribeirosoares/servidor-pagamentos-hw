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

// Aumentamos o limite para 10mb para suportar o tamanho das fotos do celular
app.use(express.json({ limit: '10mb' }));

// 2. Conecta ao seu Firebase de forma segura
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

// 3. Recebe a ordem de pagamento e gera o link do Mercado Pago
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

// 4. Rota Segura para a IA do Google Gemini
app.post('/scan-hotwheels', async (req, res) => {
    try {
        const { mimeType, imageBase64 } = req.body;

        // 1. Limpa o prefixo do Base64 se existir
        const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) return res.status(500).json({ error: "Chave não configurada." });

        // Substitua o trecho do fetch dentro da sua rota /scan-hotwheels por este:
       const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        {  text: "Você é um especialista em Hot Wheels. Olhe esta foto da cartela e identifique o nome do modelo. Responda APENAS com o nome curto do carro (ex: 'Nissan Skyline', 'Bone Shaker'). NÃO responda o código de lote. Seja exato, sem explicações, aspas ou descrições." },
                        { inline_data: { mime_type: mimeType, data: base64Data } }
                    ]
                }],
                // Opcional: Adicionando configuração de geração para garantir estabilidade
                generationConfig: {
                    temperature: 0.4,
                    topK: 32,
                    topP: 1,
                    maxOutputTokens: 100,
                }
            })
        });

        const data = await response.json();

        // 2. Loga o erro do Gemini no painel do Render se houver
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