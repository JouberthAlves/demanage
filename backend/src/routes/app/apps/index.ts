import { Router } from "express";

import entriesRouter from "./entries/index";

const router = Router();

router.use('/entries', entriesRouter);

export default router;