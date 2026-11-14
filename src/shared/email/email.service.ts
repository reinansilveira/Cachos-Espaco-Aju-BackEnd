import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
    // Sem chave a API sobe igual; só o envio de e-mail fica indisponível.
    private resend = process.env.RESEND_API_KEY
        ? new Resend(process.env.RESEND_API_KEY)
        : null;

    async sendResetCode(to: string, code: string) {
        if (!this.resend) {
            throw new ServiceUnavailableException('Envio de e-mail não configurado.');
        }
        await this.resend.emails.send({
            from: 'Espaço Cachos Aju <onboarding@resend.dev>',
            to,
            subject: 'Código de redefinição de senha',
            html: `
                <div style="font-family: sans-serif; max-width: 400px; margin: auto;">
                    <h2>Redefinição de senha</h2>
                    <p>Use o código abaixo para redefinir sua senha. Ele expira em 15 minutos.</p>
                    <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 20px; background: #f4f4f4; border-radius: 8px;">
                        ${code}
                    </div>
                    <p style="color: #999; font-size: 12px; margin-top: 20px;">Se não foi você, ignore este email.</p>
                </div>
            `,
        });
    }
}