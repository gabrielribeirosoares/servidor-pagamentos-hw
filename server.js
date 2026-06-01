const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const admin = require('firebase-admin');

const app = express();

// 1. Libera o seu site para acessar este servidor
app.use(cors({
    origin: 'https://garagemhw.web.app',
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

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

app.listen(process.env.PORT || 3000, () => console.log("Servidor Online!"));