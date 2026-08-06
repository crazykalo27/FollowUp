export type EmailTemplatePreset = {
  id: string
  label: string
  blurb: string
  subjectTemplate: string
  bodyTemplate: string
}

/** Starter layouts using app placeholder tags — import replaces your active template. */
export const EMAIL_TEMPLATE_PRESETS: EmailTemplatePreset[] = [
  {
    id: 'no_job_posting',
    label: 'No job posting',
    blurb: 'General interest when there isn’t a live posting.',
    subjectTemplate:
      'Excited about [company] – [name], [target_role]',
    bodyTemplate: `Hi [recipient],

I've been following [company]'s journey, especially your recent work on [hiring_signal]. I'm impressed by your team's impact in [industry].

I'm reaching out to express interest in contributing as a [target_role] ([employment_type], [remote]). I'd welcome a quick call to explore fit or future opportunities.

Thanks for your time!

Warm regards,

[name]
[linkedin] | [portfolio] | [website]`,
  },
  {
    id: 'job_posting',
    label: 'Job posting',
    blurb: 'You found a specific opening tied to a hiring signal.',
    subjectTemplate:
      'Application: [target_role] at [company] – [name]',
    bodyTemplate: `Hi [recipient],

I came across the [target_role] opening at [company] ([hiring_signal]) and wanted to reach out. The role aligns with what I'm looking for ([employment_type], [remote]).

I'd love to discuss how I can support your goals at [company]. My resume is attached — please let me know if you're available for a quick chat.

Best,

[name]
[linkedin] | [portfolio] | [website]`,
  },
  {
    id: 'warm_referral',
    label: 'Warm intro / referral',
    blurb: 'Short note when you found them via research or a pointer.',
    subjectTemplate: '[target_role] intro – [name] → [company]',
    bodyTemplate: `Hi [recipient],

I'm [name], exploring [employment_type] [target_role] roles ([remote]). I came across [company] through [hiring_signal] and wanted to reach out directly.

If you're not the right contact, I'd appreciate being pointed to whoever owns hiring for this area.

Thank you,

[name]
[linkedin]
[portfolio]`,
  },
  {
    id: 'technical_research',
    label: 'Technical / research',
    blurb: 'For labs, deep tech, or IC roles.',
    subjectTemplate:
      '[target_role] at [company] – [name]',
    bodyTemplate: `Hi [recipient],

Your team's work on [hiring_signal] aligns with what I want to do next as a [target_role] ([employment_type], [remote]) in [industry].

I'd welcome a 15-minute call to explore whether there's alignment.

Regards,

[name]
[github]
[linkedin]
[portfolio]`,
  },
]
