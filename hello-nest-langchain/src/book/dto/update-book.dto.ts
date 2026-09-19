import { PartialType } from '@nestjs/mapped-types';
import { CreateBookDto } from './create-book.dto.js';

export class UpdateBookDto extends PartialType(CreateBookDto) {}
