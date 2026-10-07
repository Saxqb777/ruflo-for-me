// /api/approvals — the owner's tray. GET what is waiting · POST { turn, decision: approve|reject, note?, budgetUsd? }.
import { serve } from '../src/cloud/serve.mjs';
import { approvals } from '../src/cloud/showroom.mjs';
export default (req, res) => serve(req, res, approvals, { auth: 'user' });
