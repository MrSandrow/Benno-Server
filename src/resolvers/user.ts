import { User } from "../entitites/User";
import { MyContext } from "../types";
import {
  Field,
  InputType,
  Mutation,
  Resolver,
  Arg,
  Ctx,
  ObjectType,
  Query,
  FieldResolver,
  Root,
} from "type-graphql";
import argon2 from "argon2";
import { cookieName, forgotPasswordPrefix } from "../constants";
import { sendEmail } from "../utils/sendEmails";
import { v4 } from "uuid";
import { getConnection } from "typeorm";

@InputType()
class RegisterInput {
  @Field()
  username: string;

  @Field()
  email: string;

  @Field()
  password: string;
}

@InputType()
class LoginInput {
  @Field()
  email: string;

  @Field()
  password: string;
}

@ObjectType()
class UserResponse {
  @Field(() => User, { nullable: true })
  user?: User;

  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];
}

@ObjectType()
class FieldError {
  @Field()
  field: string;

  @Field()
  message: string;
}

@Resolver(User)
export class UserResolver {
  @FieldResolver(() => String)
  email(@Root() user: User, @Ctx() { req }: MyContext): string {
    if (!req.session.userId || !user.id) {
      return "";
    }

    if (req.session.userId === user.id) {
      return user.email;
    }

    return "";
  }

  @Query(() => User, { nullable: true })
  me(@Ctx() { req }: MyContext) {
    if (!req.session.userId) return null;

    return User.findOne(req.session.userId);
  }

  @Mutation(() => UserResponse)
  async register(
    @Arg("options") options: RegisterInput,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    if (options.username.length <= 2) {
      return {
        errors: [
          {
            field: "username",
            message: "Username should be at least 3 characters long !",
          },
        ],
      };
    }

    if (!options.email.includes("@")) {
      return {
        errors: [
          {
            field: "email",
            message: "This is not a valid email !",
          },
        ],
      };
    }

    if (options.password.length <= 2) {
      return {
        errors: [
          {
            field: "password",
            message: "Password should be at least 3 characters long !",
          },
        ],
      };
    }

    const hashedPassword = await argon2.hash(options.password);

    try {
      const result = await getConnection()
        .createQueryBuilder()
        .insert()
        .into(User)
        .values({
          username: options.username,
          email: options.email,
          password: hashedPassword,
        })
        .returning("*")
        .execute();

      const user = result.raw[0];
      req.session.userId = user.id;

      return { user };
    } catch (error) {
      if (error?.code === "23505" && error?.detail.includes("username")) {
        return {
          errors: [
            {
              field: "username",
              message: "An account with this username already exists !",
            },
          ],
        };
      }

      if (error?.code === "23505" && error?.detail.includes("email")) {
        return {
          errors: [
            {
              field: "email",
              message: "An account with this email already exists !",
            },
          ],
        };
      }

      return {
        errors: [
          {
            field: "username",
            message: "An unknown error occured when creating your account !",
          },
        ],
      };
    }
  }

  @Mutation(() => UserResponse)
  async login(
    @Arg("options") options: LoginInput,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    const user = await User.findOne({ where: { email: options.email } });

    if (!user) {
      return {
        errors: [
          {
            field: "email",
            message: "This account doesn't exist !",
          },
        ],
      };
    }

    const isPasswordValid = await argon2.verify(
      user.password,
      options.password
    );

    if (!isPasswordValid) {
      return {
        errors: [
          {
            field: "password",
            message: "This password is not valid !",
          },
        ],
      };
    }

    req.session.userId = user.id;

    return { user };
  }

  @Mutation(() => Boolean)
  logout(@Ctx() { req, res }: MyContext): Promise<boolean> {
    return new Promise((resolve) => {
      req.session.destroy((error) => {
        if (error) {
          resolve(false);
          return;
        }

        res.clearCookie(cookieName);
        resolve(true);
      });
    });
  }

  @Mutation(() => Boolean)
  async forgotPassword(
    @Arg("email") email: string,
    @Ctx() { redis }: MyContext
  ): Promise<Boolean> {
    const user = await User.findOne({ where: { email } });
    if (!user) return true;

    const token = v4();
    const threeDaysInMilliseconds = 1000 * 60 * 60 * 24 * 3;

    await redis.set(
      `${forgotPasswordPrefix}${token}`,
      user.id,
      "ex",
      threeDaysInMilliseconds
    );

    const emailBody = `
      <a href='${process.env.CLIENT_URL}/change-password/${token}'>
        Reset your password
      </a>
    `;

    /* sendEmail currently doesn't work. You will need
    to provide it email credentials for it to work. */
    await sendEmail(email, emailBody);

    return true;
  }

  @Mutation(() => UserResponse)
  async changePassword(
    @Arg("token") token: string,
    @Arg("newPassword") newPassword: string,
    @Ctx() { req, redis }: MyContext
  ): Promise<UserResponse> {
    if (newPassword.length <= 2) {
      return {
        errors: [
          {
            field: "newPassword",
            message: "Password should be at least 3 characters long !",
          },
        ],
      };
    }

    const key = `${forgotPasswordPrefix}${token}`;
    const userId = await redis.get(key);

    if (!userId) {
      return {
        errors: [
          {
            field: "newPassword",
            message: "The token expired !",
          },
        ],
      };
    }

    const user = await User.findOne(parseInt(userId));

    if (!user) {
      return {
        errors: [
          {
            field: "newPassword",
            message: "This user doesn't exist !",
          },
        ],
      };
    }

    const hashedPassword = await argon2.hash(newPassword);
    await User.update({ id: user.id }, { password: hashedPassword });

    await redis.del(key);
    req.session.userId = user.id;

    return { user };
  }
}
