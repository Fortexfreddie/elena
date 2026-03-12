import 'dotenv/config';

async function setWebhook() {
    const tunnelUrl = process.env['WEBHOOK_BASE_URL'];

    if (!tunnelUrl) {
        console.error('❌ Error: Missing WEBHOOK_BASE_URL in .env');
        console.error('Example: WEBHOOK_BASE_URL=https://your-tunnel-url.loca.lt');
        process.exit(1);
    }

    const botToken = process.env['TELEGRAM_BOT_TOKEN'];
    const webhookSecret = process.env['TELEGRAM_WEBHOOK_SECRET'];

    if (!botToken || !webhookSecret) {
        console.error('❌ Error: Missing TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET in .env');
        process.exit(1);
    }

    // Ensure tunnel URL doesn't end with a slash, then append /webhook
    const cleanBaseUrl = tunnelUrl.replace(/\/$/, '');
    const webhookUrl = `${cleanBaseUrl}/webhook`;

    console.log(`Setting webhook to: ${webhookUrl}...`);

    try {
        const response = await fetch(
            `https://api.telegram.org/bot${botToken}/setWebhook`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url: webhookUrl,
                    secret_token: webhookSecret,
                }),
            },
        );

        const data = await response.json();

        if (data.ok) {
            console.log('✅ Webhook successfully set!');
            console.log(data.description);
            console.log('\nYou can now send a message to your bot on Telegram to test it.');
        } else {
            console.error('❌ Telegram API rejected the request:');
            console.error(data);
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ Failed to connect to Telegram API:');
        console.error(err);
        process.exit(1);
    }
}

setWebhook();
