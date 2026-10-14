import { sendSetupEmail, type EmailConfiguration } from '../src/lib/email';
import { inspectEmailEnvironment, validEmail } from '../src/lib/environment';

const arguments_ = process.argv.slice(2);
if (arguments_.length !== 2 || arguments_[0] !== '--to' || !validEmail(arguments_[1])) {
  console.error('Usage: npm run email:check -- --to YOUR_OWN_EMAIL_ADDRESS');
  console.error('This command sends one real setup email to the specified recipient.');
  process.exitCode = 1;
} else {
  try {
    if (!inspectEmailEnvironment(process.env).ok) throw new Error('Email configuration is incomplete.');
    const configuration: EmailConfiguration = process.env.EMAIL_PROVIDER === 'gmail' ? {
      transport: 'gmail', user: process.env.GMAIL_USER!, appPassword: process.env.GMAIL_APP_PASSWORD!, from: process.env.EMAIL_FROM!,
    } : { apiKey: process.env.RESEND_API_KEY!, from: process.env.EMAIL_FROM! };
    await sendSetupEmail(arguments_[1], configuration);
    console.log('Email accepted by the configured provider. Confirm it arrived in the requested inbox; acceptance alone does not verify delivery.');
  } catch {
    console.error('Email setup check failed. Check the selected provider, private credentials and matching sender. No credentials or message details were logged.');
    process.exitCode = 1;
  }
}
