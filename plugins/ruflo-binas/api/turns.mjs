// /api/turns — GET ?project= the conversation · POST { project, text } a new turn, or the answer to an open ask.
import { serve } from '../src/cloud/serve.mjs';
import { turns } from '../src/cloud/showroom.mjs';
export default (req, res) => serve(req, res, turns, { auth: 'user' });
