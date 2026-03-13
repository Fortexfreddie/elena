import { Module } from '@nestjs/common';
import { ProfileBuilder } from './profile-builder.service';

@Module({
    providers: [ProfileBuilder],
    exports: [ProfileBuilder],
})
export class PersonasModule { }
