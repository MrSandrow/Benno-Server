import "dotenv/config";
import "reflect-metadata";
import { cookieName, __prod__ } from "./constants";
import express from "express";
import { ApolloServer } from "apollo-server-express";
import { buildSchema } from "type-graphql";
import { PostResolver } from "./resolvers/post";
import { UserResolver } from "./resolvers/user";
import { default as Redis } from "ioredis";
import session from "express-session";
import connectRedis from "connect-redis";
import { MyContext } from "./types";
import { createConnection } from "typeorm";
import { Post } from "./entitites/Post";
import { User } from "./entitites/User";
import path from "path";
import { Updoot } from "./entitites/Updoots";
import { createUserLoader } from "./utils/createUserLoader";
import { createUpdootLoader } from "./utils/createUpdootLoader";

const main = async () => {
  await createConnection({
    type: "postgres",
    url: process.env.DATABASE_URL,
    logging: true,
    ssl: { rejectUnauthorized: false },
    migrations: [path.join(__dirname, "./migrations/*")],
    entities: [Post, User, Updoot],
  });

  const app = express();

  const RedisStore = connectRedis(session);
  const redis = new Redis(process.env.REDIS_URL);

  app.use(
    session({
      name: cookieName,
      store: new RedisStore({
        client: redis,
        disableTouch: true,
      }),
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 365 * 10, // 10 years
        httpOnly: true,
        sameSite: "lax",
        secure: __prod__,
      },
      saveUninitialized: false,
      secret: process.env.SESSION_SECRET!,
      resave: false,
    })
  );

  const apolloServer = new ApolloServer({
    context: ({ req, res }): MyContext => ({
      req,
      res,
      redis,
      userLoader: createUserLoader(),
      updootLoader: createUpdootLoader(),
    }),
    schema: await buildSchema({
      resolvers: [PostResolver, UserResolver],
      validate: false,
    }),
  });

  await apolloServer.start();
  apolloServer.applyMiddleware({
    app,
    cors: {
      origin: true,
      credentials: true,
    },
  });

  app.listen(parseInt(process.env.PORT!));
};

main().catch((error) => {
  console.log(error);
});
