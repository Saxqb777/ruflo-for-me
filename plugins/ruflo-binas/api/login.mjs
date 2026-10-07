// /api/login — GET who am I · POST { username, password } signs in (sets the session cookie) ·
// POST { password, newPassword } while signed in changes the password · DELETE signs out.
import { serve } from '../src/cloud/serve.mjs';
import { login } from '../src/cloud/showroom.mjs';
export default (req, res) => serve(req, res, login, { auth: 'optional' });
