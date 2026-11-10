"""Builds realistic (fictional) test contracts as PDFs into demo/test-contracts/.
Run: cd backend && uv run python ../demo/make_test_contracts.py"""
import html
import pathlib
import pymupdf

OUT = pathlib.Path(__file__).parent / "test-contracts"
CSS = """
body { font-family: serif; font-size: 10.5pt; line-height: 1.38; text-align: justify; }
h1 { font-size: 16pt; text-align: center; margin: 0 0 4pt 0; letter-spacing: 1pt; }
.sub { text-align: center; font-size: 10.5pt; margin: 0 0 16pt 0; }
h2 { font-family: sans-serif; font-size: 10.5pt; margin: 14pt 0 4pt 0; }
p { margin: 0 0 6pt 0; }
.sig td { padding-top: 26pt; font-size: 10pt; vertical-align: top; }
table.fee { width: 100%; border-collapse: collapse; margin: 6pt 0; }
table.fee td, table.fee th { border: 0.5pt solid #444; padding: 3pt 5pt; font-size: 9.5pt; text-align: left; }
"""


def esc(s): return html.escape(s, quote=False)


def art(n, title, subs):
    """Article n with auto-numbered sections: n.1, n.2 ... A sub is (heading, text) or just text."""
    out = [f"<h2>{n}. {esc(title.upper())}</h2>"]
    for i, s in enumerate(subs, 1):
        head, text = s if isinstance(s, tuple) else (None, s)
        dot = "" if text[:1].islower() else "."  # definitions read "Affiliate means ..."
        lead = f"<b>{n}.{i} {esc(head)}{dot}</b> " if head else f"{n}.{i} "
        out.append(f"<p>{lead}{esc(text)}</p>")
    return "".join(out)


def sig(left, right):
    cell = lambda who: (f"<td width='50%'><b>{esc(who[0])}</b><br/><br/>By: ______________________________<br/>"
                        f"Name: {esc(who[1])}<br/>Title: {esc(who[2])}<br/>Date: ____________________</td>")
    return ("<h2>SIGNATURES</h2><p>IN WITNESS WHEREOF, the parties have caused this Agreement to be executed by their duly "
            "authorized representatives as of the Effective Date.</p>"
            f"<table class='sig' width='100%'><tr>{cell(left)}{cell(right)}</tr></table>")


def build(name, title, subtitle, preamble, body_html):
    doc_html = (f"<h1>{esc(title.upper())}</h1><p class='sub'>{esc(subtitle)}</p>"
                f"<p>{esc(preamble)}</p>{body_html}")
    story = pymupdf.Story(html=doc_html, user_css=CSS)
    tmp = OUT / f".{name}.tmp.pdf"
    w = pymupdf.DocumentWriter(str(tmp))
    page = pymupdf.paper_rect("letter")
    where = page + (72, 72, -72, -84)
    more = 1
    while more:
        dev = w.begin_page(page)
        more, _ = story.place(where)
        story.draw(dev)
        w.end_page()
    w.close()
    doc = pymupdf.open(tmp)
    for i, p in enumerate(doc, 1):  # footer: confidentiality line and page number
        p.insert_text((72, 748), f"{title}  |  Confidential", fontsize=8, fontname="helv", color=(.35, .35, .35))
        p.insert_text((520, 748), f"Page {i} of {len(doc)}", fontsize=8, fontname="helv", color=(.35, .35, .35))
    doc.save(OUT / f"{name}.pdf")
    n = len(doc)
    doc.close()
    tmp.unlink()
    print(f"{name}.pdf  {n} pages")


NB = "Northwind Bank, N.A., a national banking association with its principal office at 400 Meridian Plaza, Charlotte, North Carolina 28202 (\"Northwind\")"
BP = "Brightpath Software, Inc., a Delaware corporation with its principal office at 88 Alder Street, Austin, Texas 78701 (\"Brightpath\")"
CA = "Cobalt Analytics Ltd., a company incorporated in England and Wales with its registered office at 14 Finsbury Court, London EC2A 1BQ (\"Cobalt\")"
HP = "Harbor Point Properties, LLC, a Delaware limited liability company with its principal office at 2100 Harbor Way, Austin, Texas 78702 (\"Landlord\")"


def msa():
    b = "".join([
        "<p><b>RECITALS.</b> A. Northwind is a regulated financial institution that requires software development and managed "
        "services for its retail banking platforms. B. Brightpath provides such services and has represented that it has the "
        "skill, personnel and security controls needed to perform them. C. The parties wish to set out the terms on which "
        "Brightpath will provide services under one or more Statements of Work. NOW, THEREFORE, in consideration of the mutual "
        "promises below, the parties agree as follows:</p>",
        art(1, "Definitions", [
            ("Affiliate", "means any entity that controls, is controlled by, or is under common control with a party, where control means ownership of more than fifty percent of the voting interests."),
            ("Confidential Information", "means all non-public information disclosed by one party to the other, in any form, that is marked confidential or that a reasonable person would understand to be confidential, including Customer Data, pricing, source code and security procedures."),
            ("Customer Data", "means all data of Northwind or its customers that Brightpath receives, accesses or generates in connection with the Services, including personal information of Northwind's account holders."),
            ("Services", "means the software development, maintenance, hosting and support services described in a Statement of Work."),
            ("Statement of Work", "means a written document signed by both parties that describes the Services, deliverables, schedule and fees for a project."),
        ]),
        art(2, "Services", [
            ("Provision of Services", "Brightpath will provide the Services described in each Statement of Work in a professional and workmanlike manner, in accordance with industry standards and applicable law."),
            ("Statements of Work", "Each Statement of Work is governed by this Agreement. If a Statement of Work conflicts with this Agreement, this Agreement controls unless the Statement of Work expressly identifies the provision it overrides."),
            ("Change Orders", "Either party may request a change to a Statement of Work. No change takes effect until both parties sign a written change order that states its effect on fees and schedule."),
            ("Personnel", "Brightpath will assign suitably qualified personnel and will replace any individual that Northwind reasonably objects to, within ten (10) business days of written notice."),
            ("Subcontractors", "Brightpath will not subcontract any Services without Northwind's prior written consent and remains responsible for the acts and omissions of its subcontractors as if they were its own."),
        ]),
        art(3, "Fees and Payment", [
            ("Fees", "Northwind will pay Brightpath the fees set out in Schedule A and in each Statement of Work. Except as stated there, fees include all expenses."),
            ("Invoices and Payment", "Brightpath will invoice Northwind monthly in arrears. Northwind will pay each undisputed invoice within forty-five (45) days after receipt."),
            ("Late Payment", "Undisputed amounts not paid when due accrue interest at one percent (1.0%) per month, or the highest rate permitted by law if lower, from the due date until paid."),
            ("Disputed Amounts", "If Northwind disputes an invoice in good faith, it will pay the undisputed portion and notify Brightpath of the dispute in writing within thirty (30) days. The parties will work to resolve the dispute under Section 12.2."),
            ("Taxes", "Fees exclude sales, use and similar taxes, which Northwind will pay except for taxes on Brightpath's income, property or employees."),
        ]),
        art(4, "Term and Renewal", [
            ("Initial Term", "This Agreement begins on the Effective Date and continues for three (3) years unless terminated earlier under Article 5."),
            ("Renewal", "After the initial term this Agreement renews automatically for successive one (1) year periods unless either party gives written notice of non-renewal at least ninety (90) days before the end of the then-current term."),
        ]),
        art(5, "Termination", [
            ("Termination for Convenience", "Northwind may terminate this Agreement or any Statement of Work for any reason or no reason on ninety (90) days' prior written notice to Brightpath. Brightpath may not terminate this Agreement for convenience."),
            ("Termination for Cause", "Either party may terminate this Agreement by written notice if the other party materially breaches it and fails to cure the breach within thirty (30) days after receiving written notice describing the breach."),
            ("Insolvency", "Either party may terminate this Agreement immediately by written notice if the other party becomes insolvent, makes an assignment for the benefit of creditors, or becomes the subject of bankruptcy or receivership proceedings that are not dismissed within sixty (60) days."),
            ("Regulatory Termination", "Northwind may terminate this Agreement immediately on written notice if a banking regulator directs it to do so, or if continuing the Services would cause Northwind to violate applicable law or regulatory guidance."),
            ("Effect of Termination", "On termination Northwind will pay for Services performed through the termination date in accordance with Section 3.2. Brightpath will return or securely destroy all Customer Data within thirty (30) days. Articles 6, 7, 9 and 10 survive termination."),
        ]),
        art(6, "Intellectual Property", [
            ("Northwind Property", "Northwind owns all Customer Data and all deliverables created specifically for Northwind under a Statement of Work, upon payment. Brightpath assigns to Northwind all rights in those deliverables."),
            ("Brightpath Tools", "Brightpath retains ownership of its pre-existing software, libraries and methodologies. It grants Northwind a perpetual, non-exclusive, royalty-free license to use them as embedded in the deliverables."),
            ("Open Source", "Brightpath will not incorporate open source software that requires Northwind to disclose or license its own source code without Northwind's prior written approval."),
        ]),
        art(7, "Confidentiality", [
            ("Obligations", "Each party will protect the other's Confidential Information with at least the care it uses for its own, and no less than reasonable care, and will use it only to perform or receive the Services."),
            ("Exclusions", "Confidential Information does not include information that is or becomes public through no fault of the recipient, was known to the recipient before disclosure, or is independently developed without use of the discloser's information."),
            ("Compelled Disclosure", "A party may disclose Confidential Information if required by law or by a regulator, provided that, where lawful, it gives the other party prompt notice and cooperates in seeking protective treatment."),
            ("Duration", "The obligations in this Article 7 continue for five (5) years after termination, and for as long as any Customer Data remains in Brightpath's possession."),
        ]),
        art(8, "Data Protection and Security", [
            ("Security Program", "Brightpath will maintain a written information security program with administrative, technical and physical safeguards that meet or exceed ISO/IEC 27001 and the Interagency Guidelines Establishing Information Security Standards."),
            ("Breach Notification", "Brightpath will notify Northwind in writing without undue delay and in any event within forty-eight (48) hours after becoming aware of any unauthorized access to or disclosure of Customer Data, and will cooperate in the investigation and remediation."),
            ("Audit Rights", "Northwind and its regulators may audit Brightpath's facilities, systems and records relating to the Services on reasonable notice, not more than once per year except after a security incident or at a regulator's request."),
            ("Data Location", "Brightpath will store and process Customer Data only in the United States unless Northwind consents in writing."),
        ]),
        art(9, "Indemnification", [
            ("By Brightpath", "Brightpath will defend and indemnify Northwind against third-party claims, and pay resulting damages and reasonable legal fees, to the extent arising from (a) an allegation that the deliverables infringe a third party's intellectual property rights, (b) Brightpath's breach of Article 7 or Article 8, or (c) Brightpath's gross negligence or willful misconduct."),
            ("By Northwind", "Northwind will defend and indemnify Brightpath against third-party claims arising from Brightpath's use of Customer Data in accordance with this Agreement."),
            ("Procedure", "The indemnified party must give prompt written notice of the claim, allow the indemnifying party to control the defense and settlement (provided that no settlement may admit fault of the indemnified party without its consent), and provide reasonable assistance."),
        ]),
        art(10, "Limitation of Liability", [
            ("Cap", "Except as stated in Section 10.3, each party's total liability arising out of this Agreement will not exceed the fees paid and payable by Northwind in the twelve (12) months preceding the event giving rise to the claim."),
            ("Consequential Damages", "Except as stated in Section 10.3, neither party is liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, even if advised of their possibility."),
            ("Exclusions", "The limits in Sections 10.1 and 10.2 do not apply to a party's indemnification obligations under Article 9, breach of Article 7, gross negligence, willful misconduct, or Brightpath's obligations under Section 8.2."),
        ]),
        art(11, "Insurance", [
            "During the term and for two (2) years afterwards Brightpath will maintain commercial general liability insurance of at least $2,000,000 per occurrence, professional liability (errors and omissions) insurance of at least $5,000,000 per claim, and cyber liability insurance of at least $5,000,000 per claim, and will provide certificates of insurance on request."]),
        art(12, "Governing Law and Disputes", [
            ("Governing Law", "This Agreement is governed by the laws of the State of New York, without regard to its conflict of laws rules."),
            ("Escalation", "The parties will first try to resolve any dispute through good-faith discussions between senior executives for thirty (30) days before commencing litigation, except for requests for injunctive relief."),
            ("Jurisdiction", "Subject to Section 12.2, the state and federal courts located in New York County, New York have exclusive jurisdiction, and each party submits to their jurisdiction. EACH PARTY WAIVES ANY RIGHT TO A JURY TRIAL."),
        ]),
        art(13, "General", [
            ("Notices", "Notices must be in writing and delivered by hand, by nationally recognized courier, or by certified mail to the address above, and are effective on receipt."),
            ("Assignment", "Neither party may assign this Agreement without the other's prior written consent, except to a successor to all or substantially all of its business. Any other assignment is void."),
            ("Force Majeure", "Neither party is liable for delay caused by events beyond its reasonable control, including natural disaster, war, or government action, provided it notifies the other promptly and resumes performance as soon as practicable. Payment obligations are not excused."),
            ("Entire Agreement", "This Agreement, with its Schedules and Statements of Work, is the entire agreement of the parties on its subject and supersedes all prior discussions. It may be amended only in a writing signed by both parties."),
            ("Independent Contractors", "The parties are independent contractors. Nothing in this Agreement creates a partnership, joint venture or employment relationship."),
        ]),
        sig(("NORTHWIND BANK, N.A.", "Elena Marquez", "Executive Vice President, Technology"),
            ("BRIGHTPATH SOFTWARE, INC.", "Daniel Okafor", "Chief Executive Officer")),
        "<h2>SCHEDULE A - FEES</h2><table class='fee'><tr><th>Service</th><th>Rate / Fee</th><th>Billing</th></tr>"
        "<tr><td>Senior engineer (time and materials)</td><td>$185 per hour</td><td>Monthly in arrears</td></tr>"
        "<tr><td>Engineer</td><td>$140 per hour</td><td>Monthly in arrears</td></tr>"
        "<tr><td>Managed hosting and 24x7 support</td><td>$42,000 per month</td><td>Monthly in advance</td></tr>"
        "<tr><td>Security assessment (annual)</td><td>$65,000 per year</td><td>Annually</td></tr></table>"
        "<p>Rates are fixed for the initial term. Thereafter Brightpath may increase rates by no more than three percent (3%) per year on ninety (90) days' notice.</p>",
    ])
    build("01-northwind-brightpath-master-services-agreement", "Master Services Agreement", "Northwind Bank, N.A. and Brightpath Software, Inc.",
          f"This Master Services Agreement (the \"Agreement\") is entered into as of March 1, 2024 (the \"Effective Date\") between {NB}, and {BP}.", b)


def amendment():
    b = "".join([
        "<p><b>BACKGROUND.</b> The parties are party to a Master Services Agreement dated March 1, 2024 (the \"MSA\"). Following Northwind's annual vendor review, they wish to amend certain terms of the MSA as set out below. Capitalized terms not defined here have the meanings given in the MSA.</p>",
        art(1, "Amendments", [
            ("Payment Terms", "Section 3.2 of the MSA is amended by replacing \"forty-five (45) days\" with \"thirty (30) days\"."),
            ("Termination for Convenience", "The first sentence of Section 5.1 of the MSA is amended by replacing \"ninety (90) days' prior written notice\" with \"sixty (60) days' prior written notice\"."),
            ("Breach Notification", "Section 8.2 of the MSA is amended by replacing \"forty-eight (48) hours\" with \"twenty-four (24) hours\"."),
            ("Fees", "Schedule A of the MSA is amended so that the rate for a senior engineer is $195 per hour with effect from July 1, 2025."),
        ]),
        art(2, "General", [
            ("Effect", "Except as expressly amended by this Amendment, the MSA remains in full force and effect. If this Amendment conflicts with the MSA, this Amendment controls."),
            ("Counterparts", "This Amendment may be signed in counterparts, including by electronic signature, each of which is an original and all of which are one instrument."),
            ("Governing Law", "This Amendment is governed by the laws of the State of New York."),
        ]),
        sig(("NORTHWIND BANK, N.A.", "Elena Marquez", "Executive Vice President, Technology"),
            ("BRIGHTPATH SOFTWARE, INC.", "Daniel Okafor", "Chief Executive Officer")),
    ])
    build("02-northwind-brightpath-amendment-no-1", "Amendment No. 1 to Master Services Agreement", "Northwind Bank, N.A. and Brightpath Software, Inc.",
          f"This Amendment No. 1 (the \"Amendment\") is made as of June 15, 2025 between {NB}, and {BP}.", b)


def license_():
    b = "".join([
        "<p><b>RECITALS.</b> Cobalt has developed proprietary credit-risk analytics software and wishes to license it to Northwind. Northwind wishes to obtain that license on the terms below.</p>",
        art(1, "Definitions", [
            ("Documentation", "means Cobalt's user guides and technical specifications for the Software, as updated from time to time."),
            ("Software", "means Cobalt's RiskLens credit analytics platform, in object code form, including Updates."),
            ("Authorized Users", "means Northwind's employees and contractors who are permitted by Northwind to use the Software."),
            ("Updates", "means bug fixes, patches and minor releases that Cobalt makes generally available to its licensees."),
        ]),
        art(2, "License Grant", [
            ("Grant", "Subject to the terms of this Agreement, Cobalt grants Northwind a non-exclusive, non-transferable license, without the right to sublicense, to install and use the Software for Northwind's internal business purposes, by up to 250 Authorized Users."),
            ("Restrictions", "Northwind will not copy the Software except for backup, reverse engineer or decompile it, remove proprietary notices, or use it to provide services to third parties."),
            ("Reservation", "Cobalt retains all rights in the Software. No rights are granted except as expressly stated in this Agreement."),
        ]),
        art(3, "Fees and Payment", [
            ("License Fee", "Northwind will pay an annual license fee of $480,000, invoiced on the Effective Date and each anniversary."),
            ("Payment", "Cobalt's invoices are payable within sixty (60) days after receipt."),
            ("Late Payment", "Overdue amounts accrue interest at one-half percent (0.5%) per month."),
            ("Taxes", "Fees exclude applicable taxes, which Northwind will pay, other than taxes on Cobalt's net income."),
        ]),
        art(4, "Support and Maintenance", [
            ("Support", "Cobalt will provide email and telephone support on business days between 8:00 a.m. and 6:00 p.m. Eastern Time and will provide all Updates at no extra charge."),
            ("Service Levels", "Cobalt will respond to a critical (severity 1) issue within two (2) hours and will use commercially reasonable efforts to resolve it within one (1) business day."),
            ("Service Credits", "If Cobalt misses the severity 1 response time more than twice in a calendar quarter, Northwind may claim a credit of ten percent (10%) of the annual license fee, prorated for that quarter."),
        ]),
        art(5, "Term and Termination", [
            ("Term", "This Agreement begins on the Effective Date and continues for an initial term of two (2) years, renewing for successive one-year terms unless either party gives notice of non-renewal at least sixty (60) days before the end of the term."),
            ("Termination for Convenience", "Northwind may terminate this Agreement for convenience on sixty (60) days' written notice, and will receive a refund of prepaid license fees for the period after termination."),
            ("Termination for Cause", "Either party may terminate on written notice if the other materially breaches this Agreement and fails to cure within forty-five (45) days after notice."),
            ("Effect", "On termination Northwind will stop using the Software and delete all copies within thirty (30) days and certify that it has done so. Articles 6, 7 and 8 survive."),
        ]),
        art(6, "Warranties", [
            ("Performance", "Cobalt warrants that for ninety (90) days after delivery the Software will perform materially in accordance with the Documentation. Northwind's exclusive remedy is repair or replacement, or if that is not possible, a refund of the license fee."),
            ("Disclaimer", "EXCEPT AS STATED IN THIS ARTICLE 6, THE SOFTWARE IS PROVIDED \"AS IS\" AND COBALT DISCLAIMS ALL OTHER WARRANTIES, INCLUDING MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE."),
        ]),
        art(7, "Confidentiality", [
            "Each party will keep the other's Confidential Information confidential and use it only for the purposes of this Agreement. These obligations last for three (3) years after termination. They do not apply to information that is public, already known, or independently developed."]),
        art(8, "Liability and Indemnity", [
            ("Cap", "Cobalt's total liability under this Agreement will not exceed two times (2x) the annual license fee. Northwind's total liability for claims other than payment will not exceed the annual license fee."),
            ("Excluded Damages", "Neither party is liable for indirect, consequential or special damages or lost profits."),
            ("IP Indemnity", "Cobalt will defend Northwind against third-party claims that the Software infringes a patent, copyright or trade secret, and will pay the resulting damages and costs. Cobalt has no obligation for claims caused by modifications or combinations not made by Cobalt."),
        ]),
        art(9, "General", [
            ("Governing Law", "This Agreement is governed by the laws of England and Wales. The courts of England have exclusive jurisdiction."),
            ("Assignment", "Neither party may assign this Agreement without the other's written consent, except Cobalt may assign it to a successor to its business on written notice."),
            ("Entire Agreement", "This Agreement is the entire agreement between the parties on its subject and may be amended only in writing signed by both parties."),
        ]),
        sig(("NORTHWIND BANK, N.A.", "Priya Raman", "Chief Risk Officer"), ("COBALT ANALYTICS LTD.", "James Whitcombe", "Managing Director")),
    ])
    build("03-northwind-cobalt-software-license-agreement", "Software License Agreement", "Northwind Bank, N.A. and Cobalt Analytics Ltd.",
          f"This Software License Agreement (the \"Agreement\") is entered into as of September 12, 2024 (the \"Effective Date\") between {CA}, and {NB}.", b)


def lease():
    b = "".join([
        art(1, "Premises and Term", [
            ("Premises", "Landlord leases to Tenant approximately 18,400 rentable square feet on the fourth floor of the building at 2100 Harbor Way, Austin, Texas (the \"Premises\"), together with a non-exclusive right to use the common areas and 46 parking spaces."),
            ("Term", "The term is sixty-two (62) months beginning on the Commencement Date of January 1, 2025 and ending on February 28, 2030, unless sooner terminated or extended under this Lease."),
            ("Renewal Option", "Tenant may renew this Lease for one (1) additional term of five (5) years by giving Landlord written notice at least nine (9) months before the end of the term. Rent during the renewal term is ninety-five percent (95%) of the then fair market rent."),
        ]),
        art(2, "Rent", [
            ("Base Rent", "Tenant will pay base rent of $38.50 per rentable square foot per year ($59,036.67 per month) for the first year, increasing by three percent (3%) on each anniversary of the Commencement Date."),
            ("Payment", "Rent is due in advance on the first day of each month, without notice or deduction. Rent not received within five (5) days after it is due bears a late charge of five percent (5%) of the overdue amount."),
            ("Operating Expenses", "Tenant will pay its proportionate share (6.1%) of the building's operating expenses and taxes above those of a 2025 base year."),
            ("Security Deposit", "Tenant will deposit $120,000 with Landlord on signing. Landlord will return it within thirty (30) days after the end of the term, less amounts owed by Tenant."),
        ]),
        art(3, "Use and Maintenance", [
            ("Permitted Use", "Tenant will use the Premises only for general office and software development purposes and in compliance with all laws."),
            ("Repairs", "Landlord will maintain the structure, roof, and building systems. Tenant will maintain the interior of the Premises in good condition, except for ordinary wear and damage by casualty."),
            ("Alterations", "Tenant may not make structural alterations without Landlord's written consent, which will not be unreasonably withheld. Non-structural alterations costing less than $25,000 require notice only."),
        ]),
        art(4, "Insurance and Indemnity", [
            ("Tenant Insurance", "Tenant will carry commercial general liability insurance of at least $2,000,000 per occurrence and property insurance covering its contents and improvements, naming Landlord as additional insured."),
            ("Indemnity", "Each party will indemnify the other against claims for bodily injury or property damage caused by its negligence or willful misconduct in or about the Premises."),
            ("Waiver of Subrogation", "Each party waives claims against the other for losses covered by property insurance."),
        ]),
        art(5, "Default and Termination", [
            ("Tenant Default", "Tenant is in default if it fails to pay rent within ten (10) days after written notice, or fails to perform any other obligation within thirty (30) days after written notice."),
            ("Landlord Remedies", "On a Tenant default Landlord may terminate this Lease on written notice, re-enter the Premises, and recover unpaid rent and damages, subject to its duty to use reasonable efforts to relet."),
            ("Early Termination Right", "Tenant may terminate this Lease effective at the end of month thirty-six (36) by giving Landlord at least twelve (12) months' written notice and paying a termination fee equal to six (6) months of then-current base rent."),
            ("Casualty and Condemnation", "If the Premises are materially damaged and cannot be restored within 180 days, either party may terminate on written notice. Rent abates during any period the Premises are unusable."),
        ]),
        art(6, "General", [
            ("Assignment and Subletting", "Tenant may not assign this Lease or sublet the Premises without Landlord's consent, not to be unreasonably withheld, except to an affiliate or a successor to its business."),
            ("Quiet Enjoyment", "So long as Tenant is not in default, Landlord will not disturb Tenant's possession of the Premises."),
            ("Governing Law", "This Lease is governed by the laws of the State of Texas, and venue lies in Travis County."),
            ("Entire Agreement", "This Lease is the entire agreement of the parties on its subject and may be amended only in writing signed by both."),
        ]),
        sig(("HARBOR POINT PROPERTIES, LLC", "Margaret Lindqvist", "Managing Member"), ("BRIGHTPATH SOFTWARE, INC.", "Daniel Okafor", "Chief Executive Officer")),
    ])
    build("04-harborpoint-brightpath-office-lease", "Office Lease Agreement", "Harbor Point Properties, LLC and Brightpath Software, Inc.",
          f"This Office Lease Agreement (the \"Lease\") is made as of November 20, 2024 between {HP}, and {BP} (\"Tenant\").", b)


def nda():
    b = "".join([
        "<p><b>PURPOSE.</b> The parties wish to explore a possible business relationship concerning the integration of Cobalt's analytics software with Brightpath's banking platform (the \"Purpose\") and may disclose confidential information to each other for that purpose.</p>",
        art(1, "Confidential Information", [
            ("Definition", "\"Confidential Information\" means all non-public information, in any form, disclosed by or for one party (the \"Discloser\") to the other (the \"Recipient\") in connection with the Purpose, that is marked confidential or that a reasonable person would understand to be confidential."),
            ("Exclusions", "It does not include information that is public without breach of this Agreement, was known to the Recipient before disclosure, was received from a third party without restriction, or was developed independently."),
        ]),
        art(2, "Obligations", [
            ("Use and Protection", "The Recipient will use Confidential Information only for the Purpose, will not disclose it to anyone except its employees and advisers who need to know it and are bound by equivalent duties, and will protect it with at least reasonable care."),
            ("Legally Required Disclosure", "If the Recipient is required by law to disclose Confidential Information, it will give the Discloser prompt written notice, where lawful, and disclose only what is required."),
            ("Return or Destruction", "On request the Recipient will promptly return or destroy Confidential Information and confirm in writing that it has done so, except for copies kept under automated backup or legal retention requirements."),
        ]),
        art(3, "Term", [
            ("Term", "This Agreement applies to disclosures made within two (2) years after the Effective Date."),
            ("Survival", "The Recipient's obligations continue for five (5) years after the end of that period, and for trade secrets for as long as they remain trade secrets."),
        ]),
        art(4, "General", [
            ("No License", "No license or other right in any Confidential Information is granted, and nothing obliges either party to enter into any further agreement."),
            ("Remedies", "Each party acknowledges that breach may cause irreparable harm for which damages are inadequate, and the Discloser may seek injunctive relief in addition to other remedies."),
            ("Governing Law", "This Agreement is governed by the laws of the State of Delaware, and the parties submit to the courts of Wilmington, Delaware."),
            ("Entire Agreement", "This is the entire agreement on its subject and may be amended only in writing signed by both parties."),
        ]),
        sig(("COBALT ANALYTICS LTD.", "James Whitcombe", "Managing Director"), ("BRIGHTPATH SOFTWARE, INC.", "Daniel Okafor", "Chief Executive Officer")),
    ])
    build("05-cobalt-brightpath-mutual-nda", "Mutual Non-Disclosure Agreement", "Cobalt Analytics Ltd. and Brightpath Software, Inc.",
          f"This Mutual Non-Disclosure Agreement (the \"Agreement\") is made as of January 8, 2025 (the \"Effective Date\") between {CA}, and {BP}.", b)


def employment():
    b = "".join([
        art(1, "Position and Duties", [
            ("Position", "Brightpath employs the Employee as Vice President of Engineering, reporting to the Chief Executive Officer, beginning on April 7, 2025 (the \"Start Date\")."),
            ("Duties", "The Employee will devote full working time to Brightpath's business and will perform the duties customary for the role and such others as the CEO reasonably assigns."),
        ]),
        art(2, "Compensation and Benefits", [
            ("Salary", "Brightpath will pay a base salary of $265,000 per year, in accordance with its normal payroll practices, subject to annual review."),
            ("Bonus", "The Employee is eligible for an annual target bonus of twenty percent (20%) of base salary, based on company and individual goals set by the Board."),
            ("Equity", "Subject to Board approval, the Employee will be granted options over 120,000 shares of common stock, vesting over four (4) years with a one-year cliff."),
            ("Benefits and Leave", "The Employee may participate in Brightpath's benefit plans on the same terms as other senior employees and is entitled to twenty-five (25) days of paid time off each year."),
        ]),
        art(3, "Termination", [
            ("At-Will", "Employment is at will and either party may end it at any time, subject to this Article."),
            ("Notice", "The Employee will give Brightpath at least thirty (30) days' written notice of resignation. Brightpath may waive all or part of the notice period and pay base salary in lieu."),
            ("Termination Without Cause", "If Brightpath terminates the Employee without Cause, it will pay six (6) months of base salary as severance, subject to the Employee signing a release of claims."),
            ("Cause", "\"Cause\" means material breach of this Agreement, conviction of or plea to a felony, fraud or dishonesty toward Brightpath, or willful misconduct that harms Brightpath."),
        ]),
        art(4, "Confidentiality and Inventions", [
            ("Confidentiality", "The Employee will keep Brightpath's confidential information secret during and after employment and use it only for Brightpath's benefit."),
            ("Inventions", "The Employee assigns to Brightpath all inventions and works made in the course of employment or using Brightpath's resources, and will help to perfect those rights."),
        ]),
        art(5, "Restrictive Covenants", [
            ("Non-Competition", "For twelve (12) months after employment ends, the Employee will not work for a business that develops core banking software in competition with Brightpath within the United States."),
            ("Non-Solicitation", "For twelve (12) months after employment ends, the Employee will not solicit Brightpath's employees or customers with whom the Employee dealt."),
        ]),
        art(6, "General", [
            ("Governing Law", "This Agreement is governed by the laws of the State of Texas."),
            ("Arbitration", "Disputes arising from this Agreement will be resolved by binding arbitration in Austin, Texas under the rules of the American Arbitration Association."),
            ("Entire Agreement", "This is the entire agreement on its subject, supersedes any offer letter, and may be amended only in writing signed by both parties."),
        ]),
        "<h2>SIGNATURES</h2><table class='sig' width='100%'><tr><td width='50%'><b>BRIGHTPATH SOFTWARE, INC.</b><br/><br/>By: ______________________________<br/>Name: Daniel Okafor<br/>Title: Chief Executive Officer</td>"
        "<td width='50%'><b>EMPLOYEE</b><br/><br/>______________________________<br/>Name: Rachel Tan<br/>Date: ____________________</td></tr></table>",
    ])
    build("06-brightpath-rachel-tan-employment-agreement", "Executive Employment Agreement", "Brightpath Software, Inc. and Rachel Tan",
          f"This Executive Employment Agreement is made as of March 24, 2025 between {BP}, and Rachel Tan, an individual residing in Austin, Texas (the \"Employee\").", b)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for f in (msa, amendment, license_, lease, nda, employment):
        f()
