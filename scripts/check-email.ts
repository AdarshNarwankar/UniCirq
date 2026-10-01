import { sendSetupEmail } from '../src/lib/email';
import { validEmail } from '../src/lib/environment';

const arguments_ = process.argv.slice(2);
if (arguments_.length !== 2 || arguments_[0] !== '--to' || !validEmail(arguments_[1])) {
  console.error('Usage: npm run email:check -- --to YOUR_OWN_EMAIL_ADDRESS');
  console.error('This command sends one real setup email to the specified recipient.');
  process.exitCode = 1;
} else {
  try {
    await sendSetupEmail(arguments_[1], { apiKey: process.env.RESEND_API_KEY ?? '', from: process.env.EMAIL_FROM ?? '' });
    console.log('Email accepted by Resend. Confirm it arrived in the requested inbox; acceptance alone does not verify delivery.');
  } catch {
    console.error('Email setup check failed. Check the private key, verified sender domain and provider dashboard. No credentials or message details were logged.');
    process.exitCode = 1;
  }
}
