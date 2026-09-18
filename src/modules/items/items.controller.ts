import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { seconds, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateItemDto } from './dto/create-item.dto';
import { ItemPageDto } from './dto/item-page.dto';
import { ItemResponseDto } from './dto/item-response.dto';
import { ListItemsQueryDto } from './dto/list-items-query.dto';
import { ScreenshotCaptureResponseDto } from './dto/screenshot-capture-response.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { UpdateItemStatusDto } from './dto/update-item-status.dto';
import { InvalidScreenshotException } from './exceptions/items.exceptions';
import { ITEMS_CONFIG } from './items.config';
import { ItemsService } from './items.service';
import { screenshotUploadInterceptor, ScreenshotUploadExceptionFilter } from './screenshot-upload';
import { ScreenshotService } from './screenshot.service';

const ITEM_ID_PARAM = 'id';

/** Shared across the by-id routes: an item that is not the caller's is a 404. */
const NOT_FOUND_RESPONSE = {
  status: HttpStatus.NOT_FOUND,
  description: 'No such item for this user',
};

const UNAUTHORIZED_RESPONSE = {
  status: HttpStatus.UNAUTHORIZED,
  description: 'Missing or invalid access token',
};

const ScreenshotThrottle = (): MethodDecorator =>
  Throttle({
    default: {
      limit: ITEMS_CONFIG.screenshotThrottle.limit,
      ttl: seconds(ITEMS_CONFIG.screenshotThrottle.ttlSeconds),
    },
  });

/**
 * Every route here is scoped to the authenticated user. The owner always comes
 * from the access token via @CurrentUser(), never from the body or the query,
 * so there is no way to address another user's items.
 */
@ApiTags('items')
@ApiBearerAuth()
@Controller('items')
export class ItemsController {
  constructor(
    private readonly itemsService: ItemsService,
    private readonly screenshotService: ScreenshotService,
  ) {}

  @Post('from-screenshot')
  @ScreenshotThrottle()
  @UseFilters(ScreenshotUploadExceptionFilter)
  @UseInterceptors(screenshotUploadInterceptor())
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [ITEMS_CONFIG.screenshot.fieldName],
      properties: {
        [ITEMS_CONFIG.screenshot.fieldName]: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({
    summary: 'Create an item from a product screenshot',
    description:
      'Uploads the original image, runs extraction, and either creates the item (high confidence) ' +
      'or returns a pre-filled draft for POST /items to confirm.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Extraction was confident; the item was created.',
    type: ScreenshotCaptureResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description:
      'Extraction was low-confidence; confirm via POST /items with the returned imageUrl.',
    type: ScreenshotCaptureResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Missing file, unsupported type, or image larger than 8MB',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Rate limit exceeded' })
  async createFromScreenshot(
    @CurrentUser() userId: string,
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: true,
        exceptionFactory: () =>
          new InvalidScreenshotException(
            `An image file is required (form field name: "${ITEMS_CONFIG.screenshot.fieldName}")`,
          ),
      }),
    )
    file: Express.Multer.File,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ScreenshotCaptureResponseDto> {
    const result = await this.screenshotService.capture(userId, file);
    response.status(result.autoCreated ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @Post()
  @ApiOperation({
    summary: 'Record an item the user is considering',
    description: 'The item starts in WISHLIST. Scoring attaches to it separately.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: ItemResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Validation failed' })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  create(@CurrentUser() userId: string, @Body() dto: CreateItemDto): Promise<ItemResponseDto> {
    return this.itemsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: "List the current user's items",
    description: 'Cursor-paginated, newest discovery first unless sorted otherwise.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: ItemPageDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid filter, sort or cursor' })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  list(@CurrentUser() userId: string, @Query() query: ListItemsQueryDto): Promise<ItemPageDto> {
    return this.itemsService.list(userId, query);
  }

  @Get(`:${ITEM_ID_PARAM}`)
  @ApiOperation({ summary: 'Fetch one item' })
  @ApiParam({ name: ITEM_ID_PARAM, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: ItemResponseDto })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(NOT_FOUND_RESPONSE)
  findOne(
    @CurrentUser() userId: string,
    @Param(ITEM_ID_PARAM, ParseUUIDPipe) itemId: string,
  ): Promise<ItemResponseDto> {
    return this.itemsService.findOne(userId, itemId);
  }

  @Patch(`:${ITEM_ID_PARAM}`)
  @ApiOperation({
    summary: "Correct an item's descriptive fields",
    description:
      'Allowed while the purchase decision is still open. Status changes go through ' +
      'PATCH /items/{id}/status instead.',
  })
  @ApiParam({ name: ITEM_ID_PARAM, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: ItemResponseDto })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed, or the item is past the point where fields can change',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(NOT_FOUND_RESPONSE)
  update(
    @CurrentUser() userId: string,
    @Param(ITEM_ID_PARAM, ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateItemDto,
  ): Promise<ItemResponseDto> {
    return this.itemsService.update(userId, itemId, dto);
  }

  @Patch(`:${ITEM_ID_PARAM}/status`)
  @ApiOperation({
    summary: 'Move an item through its lifecycle',
    description:
      'Only the transitions in the item state machine are accepted; SKIPPED and RETURNED are ' +
      'final.',
  })
  @ApiParam({ name: ITEM_ID_PARAM, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: ItemResponseDto })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed, or the transition is not allowed from the current status',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(NOT_FOUND_RESPONSE)
  updateStatus(
    @CurrentUser() userId: string,
    @Param(ITEM_ID_PARAM, ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateItemStatusDto,
  ): Promise<ItemResponseDto> {
    return this.itemsService.updateStatus(userId, itemId, dto);
  }

  @Delete(`:${ITEM_ID_PARAM}`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a wishlist item',
    description:
      'For undoing a mis-entry. An item that has been purchased, skipped or returned is kept ' +
      'as the history the regret statistics are built from.',
  })
  @ApiParam({ name: ITEM_ID_PARAM, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Item deleted' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The item is past the point where it can be deleted',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(NOT_FOUND_RESPONSE)
  remove(
    @CurrentUser() userId: string,
    @Param(ITEM_ID_PARAM, ParseUUIDPipe) itemId: string,
  ): Promise<void> {
    return this.itemsService.remove(userId, itemId);
  }
}
