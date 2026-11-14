import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { GoogleUserDto } from '../dto/google-user.dto';

@Injectable()
export class GoogleClientStrategy extends PassportStrategy(
  Strategy,
  'google-client',
) {
  constructor() {
    super({
      // Sem credenciais a API ainda sobe; só o login com Google falha.
      clientID: process.env.GOOGLE_CLIENT_ID || 'google-login-nao-configurado',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'google-login-nao-configurado',
      callbackURL: process.env.GOOGLE_CLIENT_CALLBACK_URL,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    const { name, emails, photos } = profile;

    const googleUser: GoogleUserDto = {
      email: emails?.[0]?.value,
      firstName: name?.givenName,
      lastName: name?.familyName,
      picture: photos?.[0]?.value,
    };

    done(null, googleUser);
  }
}
