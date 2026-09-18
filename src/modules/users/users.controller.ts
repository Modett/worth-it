import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { seconds, Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { USERS_CONFIG } from './users.config';
import { UsersService } from './users.service';

/**
 * Both password-confirming endpoints are a credential-guessing surface for a
 * stolen access token, so they get login's tight per-IP budget instead of the
 * global default.
 */
const PasswordConfirmationThrottle = (): MethodDecorator =>
  Throttle({
    default: {
      limit: USERS_CONFIG.passwordConfirmationThrottle.limit,
      ttl: seconds(USERS_CONFIG.passwordConfirmationThrottle.ttlSeconds),
    },
  });

/**
 * Everything here acts on the authenticated user only — the id comes from the
 * access token via @CurrentUser(), never from the path or body, so there is no
 * "other user's profile" to address in the first place.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: "Fetch the current user's profile" })
  @ApiResponse({ status: HttpStatus.OK, type: UserResponseDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid access token' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User no longer exists' })
  getProfile(@CurrentUser() userId: string): Promise<UserResponseDto> {
    return this.usersService.getProfile(userId);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update onboarding and preference fields',
    description: 'Only the fields present in the body are changed.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: UserResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Validation failed' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid access token' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User no longer exists' })
  updateProfile(
    @CurrentUser() userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    return this.usersService.updateProfile(userId, dto);
  }

  @Patch('me/password')
  @PasswordConfirmationThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Change the account password',
    description:
      'Revokes every refresh token for the user on success, so all devices — including this ' +
      'one — must log in again.',
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Password changed' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Validation failed' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid access token' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Current password is incorrect' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Rate limit exceeded' })
  changePassword(@CurrentUser() userId: string, @Body() dto: ChangePasswordDto): Promise<void> {
    return this.usersService.changePassword(userId, dto);
  }

  @Delete('me')
  @PasswordConfirmationThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete the account',
    description:
      'Irreversible: the user and all dependent items, scores, pauses, ratings and sessions ' +
      'are removed. Requires the current password as confirmation.',
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Account deleted' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Validation failed' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid access token' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Current password is incorrect' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Rate limit exceeded' })
  deleteAccount(@CurrentUser() userId: string, @Body() dto: DeleteAccountDto): Promise<void> {
    return this.usersService.deleteAccount(userId, dto);
  }
}
