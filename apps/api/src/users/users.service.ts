import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) throw new ConflictException('Username already taken');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        username: dto.username,
        displayName: dto.displayName,
        passwordHash,
        role: dto.role ?? 'STAFF',
        shopId: dto.shopId || null,
      },
      select: { id: true, username: true, displayName: true, role: true, shopId: true, active: true, createdAt: true },
    });
  }

  findAll() {
    return this.prisma.user.findMany({
      select: { id: true, username: true, displayName: true, role: true, shopId: true, active: true, lastLogin: true, createdAt: true },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, displayName: true, role: true, shopId: true, active: true, lastLogin: true, createdAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async changePassword(id: string, newPassword: string) {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    return this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  async deactivate(id: string) {
    return this.prisma.user.update({ where: { id }, data: { active: false } });
  }
}
