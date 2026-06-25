import dotenv from 'dotenv';

// Load local environment files before any route/client modules read process.env.
// Later files do not override earlier ones, so developer-local values win.
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env.development.local' });
dotenv.config({ path: '.env.development' });
dotenv.config({ path: '.env' });
