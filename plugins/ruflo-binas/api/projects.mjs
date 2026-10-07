// /api/projects — GET my projects (the owner: every floor, or ?floor=) · POST { title, brief, kind } opens one.
// The first turn is queued, or parked in the owner's tray when it is over the floor's allowance.
import { serve } from '../src/cloud/serve.mjs';
import { projects } from '../src/cloud/showroom.mjs';
export default (req, res) => serve(req, res, projects, { auth: 'user' });
