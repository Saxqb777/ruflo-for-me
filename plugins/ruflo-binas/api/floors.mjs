// /api/floors — the Building view: one row per floor with usage, allowance, counts, last event. Owner sees all.
import { serve } from '../src/cloud/serve.mjs';
import { floors } from '../src/cloud/showroom.mjs';
export default (req, res) => serve(req, res, floors, { auth: 'user' });
