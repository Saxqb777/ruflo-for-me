// /api/work — the cloud job board for the workshop (header x-binas-key = the master key).
// GET ?floor=all next queued turns with their projects · POST { turn, status, … } reports progress and results.
import { serve } from '../src/cloud/serve.mjs';
import { work } from '../src/cloud/showroom.mjs';
export default (req, res) => serve(req, res, work, { auth: 'key' });
