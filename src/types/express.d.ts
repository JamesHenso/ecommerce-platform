import { Role } from "@prisma/client";

export interface JwtPayloadUser{
    id: string;
    role: Role;
}

declare global{
    namespace Express{
        interface Request{
            user?: JwtPayloadUser
        }
    }
}