import axios from 'axios';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

async function setWebhook() {
  try {
    const webhookUrl = config.bot.webhookUrl + config.bot.webhookPath;
    const telegramApiUrl = `https://api.telegram.org/bot${config.bot.token}/setWebhook`;

    console.log('Setting webhook...');
    console.log('Webhook URL:', webhookUrl);

    const response = await axios.post(telegramApiUrl, {
      url: webhookUrl,
      max_connections: 40,
      drop_pending_updates: false
    });

    if (response.data.ok) {
      console.log('✅ Webhook set successfully!');
      console.log('Response:', response.data);
      logger.info('Webhook set via script', { webhookUrl });
    } else {
      console.error('❌ Failed to set webhook');
      console.error('Response:', response.data);
    }

  } catch (error: any) {
    console.error('❌ Error setting webhook:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    process.exit(1);
  }
}

setWebhook();
