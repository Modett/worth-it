import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsNotEmpty } from 'class-validator';

/**
 * Login deliberately validates less strictly than signup: rejecting a
 * too-short password here would tell an attacker the length rules rather than
 * just failing with the generic invalid-credentials error.
 */
export class LoginDto {
  @ApiProperty({ example: 'shopper@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'correct-horse-battery' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
