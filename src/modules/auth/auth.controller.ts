import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { seconds, Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AUTH_CONFIG } from './auth.config';
import { AuthService } from './auth.service';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { SignupDto } from './dto/signup.dto';
import { SignupResponseDto } from './dto/signup-response.dto';

/**
 * Tighter per-IP budget for the credential-guessing surface. Applied to signup
 * and login only; refresh and logout present a 256-bit secret, so the global
 * limit is enough for them.
 */
const CredentialThrottle = (): MethodDecorator =>
  Throttle({
    default: {
      limit: AUTH_CONFIG.credentialThrottle.limit,
      ttl: seconds(AUTH_CONFIG.credentialThrottle.ttlSeconds),
    },
  });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @Public()
  @CredentialThrottle()
  @ApiOperation({ summary: 'Create an account' })
  @ApiResponse({ status: HttpStatus.CREATED, type: SignupResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Validation failed' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Email already registered' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Rate limit exceeded' })
  signup(@Body() dto: SignupDto): Promise<SignupResponseDto> {
    return this.authService.signup(dto);
  }

  @Post('login')
  @Public()
  @CredentialThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange credentials for an access and refresh token' })
  @ApiResponse({ status: HttpStatus.OK, type: AuthTokensDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid email or password' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Rate limit exceeded' })
  login(@Body() dto: LoginDto): Promise<AuthTokensDto> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token for a new token pair',
    description:
      'The presented token is revoked and replaced. Presenting an already-revoked token ' +
      'revokes every active session for that user.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: AuthTokensDto })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Refresh token unknown, expired, revoked or replayed',
  })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokensDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke a refresh token',
    description: 'Idempotent: succeeds whether or not the token was still valid.',
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Token revoked' })
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }

  /**
   * The only authenticated route in the app so far. A mobile client resuming
   * from the background needs a cheap "is my access token still good?" check,
   * and it keeps no user profile concerns here — that's the users module.
   */
  @Get('session')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify the current access token' })
  @ApiResponse({ status: HttpStatus.OK, type: SessionResponseDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid access token' })
  session(@CurrentUser() userId: string): SessionResponseDto {
    return { userId };
  }
}
