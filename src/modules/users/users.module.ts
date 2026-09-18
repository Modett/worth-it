import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// AuthModule supplies PasswordService and TokenService: password verification
// and session revocation have one implementation, shared rather than copied.
// PrismaModule is @Global, so PrismaService needs no import here.
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
