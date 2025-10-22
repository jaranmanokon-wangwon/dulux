require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const https = require('https');

const app = express();
app.use(bodyParser.json());

// เก็บข้อมูล payment pending เพื่อ callback
const pendingPayments = new Map();

// ✅ Endpoint สำหรับรับ request จาก Roblox
app.post('/create-promptpay', async (req, res) => {
  try {
    const { username, amount, callbackUrl } = req.body;

    if (!username || !amount) {
      return res.status(400).json({ error: 'ต้องมี username และ amount' });
    }

    console.log(`🎮 รับคำขอจาก ${username} จำนวนเงิน ${amount} บาท`);

    // สร้าง PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100,
      currency: 'thb',
      payment_method_types: ['promptpay'],
      metadata: {
        username: username,
        callbackUrl: callbackUrl || null
      },
      confirm: false
    });

    // เก็บข้อมูล payment ไว้สำหรับ tracking
    pendingPayments.set(paymentIntent.id, {
      username: username,
      amount: amount,
      callbackUrl: callbackUrl,
      createdAt: new Date(),
      status: 'pending'
    });

    console.log('✅ สร้าง PaymentIntent สำเร็จ:', paymentIntent.id);

    res.json({
      success: true,
      paymentId: paymentIntent.id,
      amount: amount,
      status: paymentIntent.status,
      clientSecret: paymentIntent.client_secret,
      message: 'ส่ง client_secret ไปยัง client เพื่อ confirm payment'
    });
  } catch (err) {
    console.error('❌ Error creating PaymentIntent:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Endpoint รับ webhook จาก Stripe
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // ตรวจสอบ signature จาก Stripe
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Webhook Error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;

      case 'payment_intent.canceled':
        await handlePaymentCanceled(event.data.object);
        break;

      default:
        console.log(`⚪ Unhandled event type: ${event.type}`);
    }

    res.json({received: true});
  } catch (err) {
    console.error('❌ Error processing webhook:', err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ ฟังก์ชันจัดการการชำระเงินสำเร็จ
async function handlePaymentSuccess(paymentIntent) {
  const paymentData = pendingPayments.get(paymentIntent.id);

  if (!paymentData) {
    console.warn(`⚠️ ไม่พบข้อมูล payment: ${paymentIntent.id}`);
    return;
  }

  console.log(`✅ Payment Success! ID: ${paymentIntent.id}`);
  console.log(`   Username: ${paymentData.username}`);
  console.log(`   Amount: ${paymentData.amount} บาท`);

  // Update status
  paymentData.status = 'success';
  paymentData.completedAt = new Date();

  // ส่ง callback กลับไปยัง Roblox
  if (paymentData.callbackUrl) {
    await sendCallback(paymentData.callbackUrl, {
      success: true,
      username: paymentData.username,
      paymentId: paymentIntent.id,
      amount: paymentData.amount,
      status: 'completed',
      timestamp: new Date().toISOString()
    });
  }
}

// ✅ ฟังก์ชันจัดการการชำระเงินล้มเหลว
async function handlePaymentFailed(paymentIntent) {
  const paymentData = pendingPayments.get(paymentIntent.id);

  if (!paymentData) {
    console.warn(`⚠️ ไม่พบข้อมูล payment: ${paymentIntent.id}`);
    return;
  }

  console.error(`❌ Payment Failed! ID: ${paymentIntent.id}`);
  console.error(`   Username: ${paymentData.username}`);
  console.error(`   Error: ${paymentIntent.last_payment_error?.message || 'Unknown error'}`);

  // Update status
  paymentData.status = 'failed';
  paymentData.failedAt = new Date();
  paymentData.failureReason = paymentIntent.last_payment_error?.message;

  // ส่ง callback กลับไปยัง Roblox
  if (paymentData.callbackUrl) {
    await sendCallback(paymentData.callbackUrl, {
      success: false,
      username: paymentData.username,
      paymentId: paymentIntent.id,
      amount: paymentData.amount,
      status: 'failed',
      reason: paymentIntent.last_payment_error?.message || 'Payment failed',
      timestamp: new Date().toISOString()
    });
  }
}

// ✅ ฟังก์ชันจัดการการยกเลิกการชำระเงิน
async function handlePaymentCanceled(paymentIntent) {
  const paymentData = pendingPayments.get(paymentIntent.id);

  if (!paymentData) {
    console.warn(`⚠️ ไม่พบข้อมูล payment: ${paymentIntent.id}`);
    return;
  }

  console.warn(`⚠️ Payment Canceled! ID: ${paymentIntent.id}`);
  console.warn(`   Username: ${paymentData.username}`);

  // Update status
  paymentData.status = 'canceled';
  paymentData.canceledAt = new Date();

  // ส่ง callback กลับไปยัง Roblox
  if (paymentData.callbackUrl) {
    await sendCallback(paymentData.callbackUrl, {
      success: false,
      username: paymentData.username,
      paymentId: paymentIntent.id,
      amount: paymentData.amount,
      status: 'canceled',
      reason: 'Payment was canceled by user or timeout',
      timestamp: new Date().toISOString()
    });
  }
}

// ✅ ฟังก์ชันส่ง callback ไปยัง Roblox
async function sendCallback(callbackUrl, data) {
  return new Promise((resolve, reject) => {
    console.log(`📤 ส่ง callback ไปยัง: ${callbackUrl}`);
    console.log(`📦 ข้อมูล:`, data);

    const payload = JSON.stringify(data);

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const request = https.request(callbackUrl, options, (res) => {
      let responseData = '';

      res.on('data', chunk => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`✅ Callback ส่งสำเร็จ! Response:`, responseData);
          resolve(true);
        } else {
          console.error(`❌ Callback ส่งไม่สำเร็จ! Status: ${res.statusCode}`);
          reject(new Error(`Callback failed with status ${res.statusCode}`));
        }
      });
    });

    request.on('error', (err) => {
      console.error('❌ Callback Error:', err.message);
      reject(err);
    });

    request.write(payload);
    request.end();
  });
}

// ✅ Endpoint สำหรับตรวจสอบสถานะ payment
app.get('/payment-status/:paymentId', (req, res) => {
  const { paymentId } = req.params;
  const paymentData = pendingPayments.get(paymentId);

  if (!paymentData) {
    return res.status(404).json({ error: 'ไม่พบ payment นี้' });
  }

  res.json({
    paymentId: paymentId,
    username: paymentData.username,
    amount: paymentData.amount,
    status: paymentData.status,
    createdAt: paymentData.createdAt,
    completedAt: paymentData.completedAt || null,
    failureReason: paymentData.failureReason || null
  });
});

// ✅ Endpoint สำหรับลบข้อมูล payment เก่า (ตัวเลือก)
app.delete('/payment/:paymentId', (req, res) => {
  const { paymentId } = req.params;
  if (pendingPayments.has(paymentId)) {
    pendingPayments.delete(paymentId);
    res.json({ success: true, message: 'ลบสำเร็จ' });
  } else {
    res.status(404).json({ error: 'ไม่พบ payment นี้' });
  }
});

app.listen(3000, () => console.log('🚀 Server ทำงานที่พอร์ต 3000'));