import { storage } from "./storage";
import type { Match, Participant, Tournament } from "@shared/schema";
import { computeCategoryRankings } from "@shared/stats";

async function getEmailConfig(): Promise<{ apiKey: string; fromEmail: string } | null> {
  const connConfig = await getConnectorConfig();
  if (connConfig) return connConfig;

  const envKey = process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY;
  const envFrom = process.env.EMAIL_FROM || 'onboarding@resend.dev';
  if (envKey) {
    return { apiKey: envKey, fromEmail: envFrom };
  }

  return null;
}

async function getConnectorConfig(): Promise<{ apiKey: string; fromEmail: string } | null> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken || !hostname) {
    return null;
  }

  try {
    const res = await fetch(
      'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=sendgrid',
      {
        headers: {
          'Accept': 'application/json',
          'X-Replit-Token': xReplitToken
        }
      }
    );

    if (!res.ok) {
      console.error(`Connector API returned ${res.status}: ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    const connectionSettings = data.items?.[0];

    if (!connectionSettings?.settings?.api_key) {
      return null;
    }

    return {
      apiKey: connectionSettings.settings.api_key as string,
      fromEmail: (connectionSettings.settings.from_email as string) || 'onboarding@resend.dev'
    };
  } catch (err) {
    console.error("Failed to get connector config:", err);
    return null;
  }
}

async function sendEmail(to: string, from: string, subject: string, html: string, apiKey: string): Promise<boolean> {
  if (apiKey.startsWith('re_')) {
    const lowerFrom = from.toLowerCase();
    const publicDomains = ['@gmail.com', '@yahoo.com', '@hotmail.com', '@outlook.com', '@aol.com', '@icloud.com', '@protonmail.com', '@mail.com'];
    const isPublicDomain = publicDomains.some(d => lowerFrom.endsWith(d));
    const fromAddress = isPublicDomain ? 'onboarding@resend.dev' : from;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `Arm Wrestling Bracket Builder <${fromAddress}>`,
        to: [to],
        reply_to: from,
        subject,
        html
      })
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API error ${res.status}: ${body}`);
    }
    return true;
  }

  if (apiKey.startsWith('SG.')) {
    const sgMail = (await import('@sendgrid/mail')).default;
    sgMail.setApiKey(apiKey);
    await sgMail.send({
      to,
      from: { email: from, name: "Arm Wrestling Bracket Builder" },
      subject,
      html
    });
    return true;
  }

  console.warn("Unknown API key format — cannot determine email provider");
  return false;
}

function computeRankings(matches: Match[], participants: Participant[], category: string | null): { rank: number; name: string }[] {
  return computeCategoryRankings(matches, participants, category).map(r => ({ rank: r.rank, name: r.name }));
}

function generateResultsHtml(tournament: Tournament, matches: Match[], participants: Participant[]): string {
  const categories = tournament.weightCategories && tournament.weightCategories.length > 0
    ? tournament.weightCategories
    : [null];

  let categorySections = "";
  for (const cat of categories) {
    const rankings = computeRankings(matches, participants, cat);
    if (rankings.length === 0) continue;

    const title = cat || "Open";
    const medals = ["🥇", "🥈", "🥉"];

    let rows = "";
    for (const r of rankings) {
      const medal = r.rank <= 3 ? medals[r.rank - 1] : "";
      rows += `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:${r.rank <= 3 ? 'bold' : 'normal'}">${medal} ${r.rank}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${r.name}</td>
      </tr>`;
    }

    categorySections += `
      <div style="margin-bottom:24px">
        <h3 style="font-size:16px;font-weight:bold;color:#7c3aed;margin-bottom:8px;padding-bottom:4px;border-bottom:2px solid #7c3aed">${title}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #d1d5db;width:80px">Place</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #d1d5db">Competitor</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  const cocMatches = matches.filter(m => m.bracket === "champion_of_champions");
  let cocSection = "";
  if (cocMatches.length > 0) {
    const maxRound = Math.max(...cocMatches.map(m => m.round));
    const finalMatch = cocMatches.find(m => m.round === maxRound && m.matchIndex === 0);
    if (finalMatch?.winnerId) {
      const champName = participants.find(p => p.id === finalMatch.winnerId)?.name || "Unknown";
      cocSection = `
        <div style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:20px;border-radius:12px;text-align:center;margin-bottom:24px">
          <p style="font-size:12px;text-transform:uppercase;letter-spacing:2px;margin:0 0 4px 0;opacity:0.9">Champion of Champions</p>
          <p style="font-size:24px;font-weight:bold;margin:0">🏆 ${champName} 🏆</p>
        </div>
      `;
    }
  }

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb">
      <div style="max-width:600px;margin:0 auto;padding:24px">
        <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white;padding:24px;border-radius:12px 12px 0 0;text-align:center">
          <h1 style="margin:0;font-size:24px">🏋️ Tournament Results</h1>
          <p style="margin:8px 0 0 0;opacity:0.9;font-size:16px">${tournament.name}</p>
        </div>
        <div style="background:white;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
          ${cocSection}
          ${categorySections}
          <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:24px">
            Generated by Arm Wrestling Bracket Builder
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export async function sendResultsEmail(tournamentId: string): Promise<{ sent: boolean; email?: string; error?: string }> {
  const tournament = await storage.getTournament(tournamentId);
  if (!tournament) return { sent: false, error: "Tournament not found" };

  let recipientEmail = tournament.email;
  if (!recipientEmail && tournament.userId) {
    const user = await storage.getUser(tournament.userId);
    if (user?.email) recipientEmail = user.email;
  }

  if (!recipientEmail) return { sent: false, error: "No recipient email configured" };

  const details = await storage.getTournamentWithDetails(tournamentId);
  if (!details) return { sent: false, error: "Tournament details not found" };

  const html = generateResultsHtml(tournament, details.matches, details.participants);

  try {
    const config = await getEmailConfig();
    if (config) {
      const sent = await sendEmail(
        recipientEmail,
        config.fromEmail,
        `Tournament Results: ${tournament.name}`,
        html,
        config.apiKey
      );
      if (sent) {
        console.log(`Results email sent to ${recipientEmail} for tournament "${tournament.name}"`);
        return { sent: true, email: recipientEmail };
      }
      return { sent: false, error: "Email provider returned failure" };
    } else {
      console.log(`Email not configured. Would send results to ${recipientEmail} for tournament "${tournament.name}"`);
      return { sent: false, error: "Email service not configured" };
    }
  } catch (error: any) {
    console.error("Failed to send results email:", error);
    return { sent: false, error: error.message || "Unknown email error" };
  }
}
