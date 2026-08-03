import { Router } from "express";

import postEntriesRouter from "./[POST] - entries";

const router = Router();

router.use('/', postEntriesRouter);

export default router;