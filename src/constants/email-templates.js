export const OTP_EMAIL_TEMPLATE = (otp) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your OTP Code</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, Helvetica, sans-serif; }
  </style>
</head>
<body>
  <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="600" border="0" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; padding:40px;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <h1 style="color:#1a1a1a; font-size:28px; margin:0;">Onliny AI Phone</h1>
            </td>
          </tr>
          <tr>
            <td style="color:#444444; font-size:16px; line-height:1.6; padding-bottom:24px;">
              <p style="margin:0;">Your one-time verification code is:</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <div style="display:inline-block; background-color:#f0f4ff; border-radius:8px; padding:20px 40px;">
                <span style="font-size:36px; font-weight:bold; letter-spacing:8px; color:#3b5bdb;">${otp}</span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="color:#888888; font-size:14px; line-height:1.6;">
              <p style="margin:0;">This code will expire in <strong>10 minutes</strong>. Do not share this code with anyone.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
