import { Request, Response } from "express";
import session from "express-session";
import { Redis } from "ioredis";
import { createUpdootLoader } from "./utils/createUpdootLoader";
import { createUserLoader } from "./utils/createUserLoader";

type MyRequest = Request & {
  session: session.Session & Partial<session.SessionData> & { userId?: number };
};

export type MyContext = {
  req: MyRequest;
  res: Response;
  redis: Redis;
  userLoader: ReturnType<typeof createUserLoader>;
  updootLoader: ReturnType<typeof createUpdootLoader>;
};
