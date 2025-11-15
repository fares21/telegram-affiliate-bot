import axios from 'axios';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

async function removeWebhook() {
  try {
    const telegramApiUrl = `https://api.telegram.org/bot${config.bot.token}/deleteWebhook`;

    console.log('Removing webhook...');

    const response = await axios.post(telegramApiUrl, {
      drop_pending_updates: true
    });

    if (response.data.ok) {
      console.log('✅ Webhook removed successfully!');
      console.log('Response:', response.data);
      logger.info('Webhook removed via script');
    } else {
      console.error('❌ Failed to remove webhook');
      console.error('Response:', response.data);
    }

  } catch (error: any) {
    console.error('❌ Error removing webhook:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    process.exit(1);
  }
}

removeWebhook();
