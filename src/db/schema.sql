-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ReifenPro — vollstaendige Datenbankstruktur
--
-- WARUM DIESE DATEI NEU ERZEUGT WURDE: Beim Umbau auf die Serverstruktur sind die alten
-- Migrationsdateien aus dem Repository gefallen. Danach standen hier nur noch 10 von 37
-- produktiven Tabellen; `npm run migrate` brach gegen eine leere Datenbank schon in der
-- ersten Haelfte ab ("relation einstellungen does not exist"). Die Struktur lebte damit
-- ausschliesslich in der laufenden Datenbank.
--
-- Was das bedeutete: Die naechtliche Sicherung sichert Daten UND Struktur im Dump — geht
-- aber der Cluster verloren und ist der letzte Dump beschaedigt oder zu alt, liess sich
-- das System aus dem Repository heraus nicht wieder aufbauen. Fuer das Rechnungswesen kommt
-- hinzu, dass die GoBD-Verfahrensdokumentation eine vollstaendige Systembeschreibung
-- verlangt, und mehrere der fehlenden Tabellen selbst aufbewahrungsrelevant sind
-- (protokolle, dsgvo_anfragen, kunden_dokumente).
--
-- Auch der Schutztrigger trg_dokument_schutz fehlte hier — der, der unterschriebene
-- Kundendokumente vor Loeschung und Aenderung bewahrt.
--
-- HERKUNFT: Strukturabzug der Produktionsdatenbank, erzeugt am 03.09.2026.
-- Neu erzeugen mit:
--   sudo -u postgres pg_dump -d reifenpro --schema-only --no-owner --no-privileges --no-comments
-- Danach diesen Kopf, die Erklaerungen zu den Schutztriggern und den GRANT-Block wieder
-- voranstellen bzw. anhaengen.
--
-- GEGENGEPRUEFT: Auf einer leeren Wegwerf-Datenbank von vorn bis hinten durchgelaufen,
-- 37 von 37 Tabellen, kein Unterschied zur Produktion, alle sieben Trigger vorhanden.
-- ═══════════════════════════════════════════════════════════════════════════════════════

--
-- PostgreSQL database dump
--

\restrict di4F3LexMlj0xxXpa0HwqCopMXoSbixuKjbZcX617qqQlGCIgvLOMAoN2JBdlo7

-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: dokument_schutz(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dokument_schutz() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.unterschrift_kunde IS NOT NULL OR OLD.scan_pfad IS NOT NULL THEN
      RAISE EXCEPTION 'Unterschriebene Dokumente duerfen nicht geloescht werden (Aufbewahrungspflicht).';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.unterschrift_kunde IS NOT NULL OR OLD.scan_pfad IS NOT NULL THEN
    IF NEW.unterschrift_kunde IS DISTINCT FROM OLD.unterschrift_kunde
       OR NEW.unterschrift_datum IS DISTINCT FROM OLD.unterschrift_datum
       OR NEW.scan_pfad         IS DISTINCT FROM OLD.scan_pfad
       OR NEW.unterschrift_weg  IS DISTINCT FROM OLD.unterschrift_weg
       OR NEW.inhalt_html       IS DISTINCT FROM OLD.inhalt_html
       OR NEW.typ               IS DISTINCT FROM OLD.typ
       OR NEW.titel             IS DISTINCT FROM OLD.titel
       OR NEW.kunden_id         IS DISTINCT FROM OLD.kunden_id
       OR NEW.version           IS DISTINCT FROM OLD.version THEN
      RAISE EXCEPTION 'Ein unterschriebenes Dokument darf inhaltlich nicht mehr geaendert werden.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: rechnung_pos_schutz(); Type: FUNCTION; Schema: public; Owner: -
--

-- Positionen einer festgeschriebenen/stornierten Rechnung sind unveraenderbar (UPDATE/DELETE gesperrt).
-- INSERT bleibt erlaubt, da der Storno seine Positionen nach dem Festschreiben-Status anlegt.
CREATE FUNCTION public.rechnung_pos_schutz() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM rechnungen WHERE id = OLD.rechnung_id;
  IF st IN ('festgeschrieben','storniert') THEN
    RAISE EXCEPTION 'GoBD: Positionen einer festgeschriebenen Rechnung sind unveränderbar.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: rechnung_schutz(); Type: FUNCTION; Schema: public; Owner: -
--

-- ── GoBD: Unveraenderbarkeit festgeschriebener/stornierter Rechnungen ──
-- Sperrt jedes DELETE sowie das Aendern der eingefrorenen Inhalts-/Pflichtfelder, sobald eine
-- Rechnung festgeschrieben oder storniert ist. Erlaubt bleiben nur administrative Felder
-- (zahlungsstatus, bezahlt_am, mahnstufe, mahnung_am), der Statuswechsel
-- festgeschrieben->storniert und das EINMALIGE Setzen des PDF-Pfads (NULL->Wert, z. B. beim Storno).
CREATE FUNCTION public.rechnung_schutz() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('festgeschrieben','storniert') THEN
      RAISE EXCEPTION 'GoBD: Festgeschriebene/stornierte Rechnung % darf nicht gelöscht werden.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('festgeschrieben','storniert') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'festgeschrieben' AND NEW.status = 'storniert') THEN
      RAISE EXCEPTION 'GoBD: Unzulässiger Statuswechsel % -> % (Rechnung %).', OLD.status, NEW.status, COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
    IF NEW.rechnungsnr          IS DISTINCT FROM OLD.rechnungsnr
       OR NEW.kunden_id         IS DISTINCT FROM OLD.kunden_id
       OR NEW.empfaenger_anrede   IS DISTINCT FROM OLD.empfaenger_anrede
       OR NEW.empfaenger_vorname  IS DISTINCT FROM OLD.empfaenger_vorname
       OR NEW.empfaenger_nachname IS DISTINCT FROM OLD.empfaenger_nachname
       OR NEW.empfaenger_name     IS DISTINCT FROM OLD.empfaenger_name
       OR NEW.empfaenger_firma    IS DISTINCT FROM OLD.empfaenger_firma
       OR NEW.empfaenger_strasse  IS DISTINCT FROM OLD.empfaenger_strasse
       OR NEW.empfaenger_plz      IS DISTINCT FROM OLD.empfaenger_plz
       OR NEW.empfaenger_ort      IS DISTINCT FROM OLD.empfaenger_ort
       OR NEW.empfaenger_land     IS DISTINCT FROM OLD.empfaenger_land
       OR NEW.aussteller          IS DISTINCT FROM OLD.aussteller
       OR NEW.rechnungsdatum      IS DISTINCT FROM OLD.rechnungsdatum
       OR NEW.leistungsdatum      IS DISTINCT FROM OLD.leistungsdatum
       OR NEW.faelligkeit         IS DISTINCT FROM OLD.faelligkeit
       OR NEW.netto_summe         IS DISTINCT FROM OLD.netto_summe
       OR NEW.mwst_summe          IS DISTINCT FROM OLD.mwst_summe
       OR NEW.brutto_summe        IS DISTINCT FROM OLD.brutto_summe
       OR NEW.mwst_aufschluesselung IS DISTINCT FROM OLD.mwst_aufschluesselung
       OR NEW.storno_von_id       IS DISTINCT FROM OLD.storno_von_id
       OR NEW.festgeschrieben_am  IS DISTINCT FROM OLD.festgeschrieben_am
       OR NEW.erstellt_von        IS DISTINCT FROM OLD.erstellt_von
       OR NEW.erstellt_am         IS DISTINCT FROM OLD.erstellt_am
       OR NEW.notizen             IS DISTINCT FROM OLD.notizen THEN
      RAISE EXCEPTION 'GoBD/§14: Inhalt der festgeschriebenen Rechnung % ist unveränderbar.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
    IF OLD.pdf_pfad IS NOT NULL AND NEW.pdf_pfad IS DISTINCT FROM OLD.pdf_pfad THEN
      RAISE EXCEPTION 'GoBD: Der Beleg-PDF-Pfad der Rechnung % darf nicht ausgetauscht werden.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: update_geaendert_am(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_geaendert_am() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.geaendert_am = NOW(); RETURN NEW; END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: artikel; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artikel (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    preis numeric(8,2) DEFAULT 0 NOT NULL,
    einheit text DEFAULT 'Stueck'::text,
    kategorie text DEFAULT 'sonstiges'::text,
    aktiv boolean DEFAULT true,
    sortierung integer DEFAULT 0,
    erstellt_am timestamp with time zone DEFAULT now(),
    dauer_minuten integer DEFAULT 30,
    beschreibung text,
    mwst_satz numeric DEFAULT 19,
    artikelnr text
);


--
-- Name: artikel_preise; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artikel_preise (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    artikel_id uuid NOT NULL,
    fahrzeug_typ text,
    zoll_min integer,
    zoll_max integer,
    preis numeric(10,2) DEFAULT 0 NOT NULL,
    mwst_satz numeric(4,1) DEFAULT 19 NOT NULL,
    dauer_minuten integer,
    erstellt_am timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    aktion text NOT NULL,
    tabelle text,
    datensatz_id text,
    alte_werte jsonb,
    neue_werte jsonb,
    ip_adresse inet,
    erstellt_am timestamp with time zone DEFAULT now()
);


--
-- Name: besondere_tage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.besondere_tage (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    datum date NOT NULL,
    bezeichnung text,
    geschlossen boolean DEFAULT true,
    von time without time zone,
    bis time without time zone,
    quelle text DEFAULT 'manuell'::text
);


--
-- Name: betriebsurlaub; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.betriebsurlaub (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    von_datum date NOT NULL,
    bis_datum date NOT NULL,
    beschreibung text,
    erstellt_am timestamp with time zone DEFAULT now()
);


--
-- Name: buchung_leistungen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buchung_leistungen (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    artikel_id uuid,
    rolle text DEFAULT 'haupt'::text NOT NULL,
    titel text,
    beschreibung text,
    bild_url text,
    sortierung integer DEFAULT 0,
    aktiv boolean DEFAULT true,
    erstellt_am timestamp with time zone DEFAULT now()
);


--
-- Name: dokument_scan_token; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dokument_scan_token (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    dokument_id uuid NOT NULL,
    jti text NOT NULL,
    erstellt_von uuid,
    erstellt_am timestamp with time zone DEFAULT now() NOT NULL,
    gueltig_bis timestamp with time zone NOT NULL,
    verbraucht_am timestamp with time zone,
    ip text
);


--
-- Name: dsgvo_anfragen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dsgvo_anfragen (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    kunden_id uuid NOT NULL,
    typ text NOT NULL,
    status text DEFAULT 'offen'::text NOT NULL,
    nachricht text,
    antwort text,
    bearbeitet_am timestamp with time zone,
    bearbeitet_von uuid,
    erstellt_am timestamp with time zone DEFAULT now(),
    CONSTRAINT dsgvo_anfragen_status_check CHECK ((status = ANY (ARRAY['offen'::text, 'bearbeitet'::text, 'abgelehnt'::text]))),
    CONSTRAINT dsgvo_anfragen_typ_check CHECK ((typ = ANY (ARRAY['auskunft'::text, 'export'::text, 'loeschung'::text, 'berichtigung'::text, 'einschraenkung'::text, 'widerruf'::text, 'widerspruch'::text])))
);


--
-- Name: einlagerung_platz_historie; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.einlagerung_platz_historie (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    einlagerung_id uuid NOT NULL,
    lagerplatz text NOT NULL,
    von timestamp with time zone DEFAULT now() NOT NULL,
    bis timestamp with time zone,
    grund text,
    geaendert_von uuid
);


--
-- Name: einlagerungen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.einlagerungen (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    beleg_nr text NOT NULL,
    kunden_id uuid NOT NULL,
    reifen_groesse text NOT NULL,
    reifen_typ text NOT NULL,
    reifen_marke text,
    reifen_modell text,
    profil_vl numeric(4,1),
    profil_vr numeric(4,1),
    profil_hl numeric(4,1),
    profil_hr numeric(4,1),
    anzahl integer DEFAULT 4 NOT NULL,
    felgen text DEFAULT 'Nein'::text,
    dot text,
    lagerplatz text NOT NULL,
    status text DEFAULT 'Eingelagert'::text NOT NULL,
    eingelagert_am date DEFAULT CURRENT_DATE NOT NULL,
    abholbereit_am timestamp with time zone,
    abgeholt_am timestamp with time zone,
    bemerkungen text,
    erstellt_von uuid,
    geaendert_von uuid,
    erstellt_am timestamp with time zone DEFAULT now(),
    geaendert_am timestamp with time zone DEFAULT now(),
    fahrzeug_id uuid,
    vorgaenger_id uuid,
    CONSTRAINT einlagerungen_reifen_typ_check CHECK ((reifen_typ = ANY (ARRAY['Winter'::text, 'Sommer'::text, 'Ganzjahr'::text]))),
    CONSTRAINT einlagerungen_status_check CHECK ((status = ANY (ARRAY['Eingelagert'::text, 'Abholbereit'::text, 'Abgeholt'::text])))
);


--
-- Name: einstellungen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.einstellungen (
    id integer NOT NULL,
    firmenname text DEFAULT 'Reifen Penzberg'::text,
    inhaber text DEFAULT ''::text,
    strasse text DEFAULT ''::text,
    plz text DEFAULT ''::text,
    ort text DEFAULT ''::text,
    telefon text DEFAULT ''::text,
    email text DEFAULT ''::text,
    website text DEFAULT ''::text,
    steuernummer text DEFAULT ''::text,
    logo_url text,
    google_bewertung_url text DEFAULT ''::text,
    impressum text DEFAULT ''::text,
    versicherung_name text DEFAULT ''::text,
    einlagerung_preis_komplett numeric(8,2) DEFAULT 49.00,
    einlagerung_preis_ohne_felgen numeric(8,2) DEFAULT 39.00,
    kofferraum_preis numeric(8,2) DEFAULT 0.00,
    reifenwechsel_preis numeric(8,2) DEFAULT 29.00,
    zusatzleistungen text DEFAULT ''::text,
    vertragsdauer_monate integer DEFAULT 6,
    verlaengerung_automatisch boolean DEFAULT true,
    abholungsfrist_wochen integer DEFAULT 4,
    mahngebuehr numeric(8,2) DEFAULT 15.00,
    lagerungsort text DEFAULT 'in unserem Betrieb'::text,
    email_einlagerung text DEFAULT ''::text,
    email_abholbereit text DEFAULT ''::text,
    email_bewertung text DEFAULT ''::text,
    email_raeder_nachziehen text DEFAULT 'Bitte denken Sie daran, die Radschrauben nach ca. 50-100 km nachzuziehen.'::text,
    email_erinnerung text DEFAULT ''::text,
    mo_fr_von time without time zone DEFAULT '08:00:00'::time without time zone,
    mo_fr_bis time without time zone DEFAULT '18:00:00'::time without time zone,
    sa_von time without time zone DEFAULT '08:00:00'::time without time zone,
    sa_bis time without time zone DEFAULT '13:00:00'::time without time zone,
    sa_offen boolean DEFAULT true,
    termine_pro_stunde integer DEFAULT 2,
    geaendert_am timestamp with time zone DEFAULT now(),
    rechtsform text DEFAULT 'Einzelunternehmen'::text,
    handelsreg_nr text DEFAULT ''::text,
    registergericht text DEFAULT ''::text,
    ust_id text DEFAULT ''::text,
    agb_zusatz text DEFAULT ''::text,
    datenschutz_beauftragter text DEFAULT ''::text,
    portal_url text DEFAULT 'http://161.97.187.239/reifenpro/portal/'::text,
    stornierung_frist_h integer DEFAULT 24,
    email_termin_bestaetigung text,
    email_termin_erinnerung text,
    email_termin_stornierung text,
    email_neukunde_admin text,
    saison_erinnerung_wochen integer DEFAULT 3,
    so_offen boolean DEFAULT false,
    so_von time without time zone,
    so_bis time without time zone,
    mittagspause_von time without time zone,
    mittagspause_bis time without time zone,
    max_parallele_termine integer DEFAULT 1,
    bank text,
    iban text,
    bic text,
    zahlungsziel_tage integer DEFAULT 14,
    aktion_aktiv boolean DEFAULT false,
    aktion_text text,
    aktion_code text,
    aktion_position text DEFAULT 'leiste'::text,
    aktion_link text,
    buchung_aktiv boolean DEFAULT true,
    buchung_titel text,
    buchung_text text,
    nav_links jsonb,
    facebook_url text,
    instagram_url text,
    geo_breite text,
    geo_laenge text,
    datev_berater_nr text,
    datev_mandant_nr text,
    datev_konto_debitoren text DEFAULT '1400'::text,
    datev_konto_erloes_19 text DEFAULT '8400'::text,
    datev_konto_erloes_7 text DEFAULT '8300'::text,
    datev_sachkontenlaenge integer DEFAULT 4,
    dok_ds_version text DEFAULT '2026-07'::text,
    dok_vertrag_version text DEFAULT '2026-07'::text,
    dok_ds_gueltig_monate integer DEFAULT 24,
    design_config jsonb,
    seo_config jsonb,
    bundesland text DEFAULT 'BY'::text,
    preise_inkl_mwst boolean DEFAULT true,
    buchbar_ab date DEFAULT '2026-10-01'::date,
    oeffnungszeiten_hinweis text,
    handwerkskammer text,
    berufsbezeichnung text,
    berufsbezeichnung_staat text,
    berufsrechtliche_regelungen text,
    schlichtung_bereit boolean DEFAULT false NOT NULL,
    schlichtung_stelle text,
    besucher_ausschluss text
);


--
-- Name: einstellungen_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.einstellungen_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: einstellungen_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.einstellungen_id_seq OWNED BY public.einstellungen.id;


--
-- Name: email_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    empfaenger text NOT NULL,
    betreff text NOT NULL,
    typ text NOT NULL,
    status text DEFAULT 'gesendet'::text,
    fehler_msg text,
    bezug_id uuid,
    erstellt_am timestamp with time zone DEFAULT now()
);


--
-- Name: fahrzeuge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fahrzeuge (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    kunden_id uuid NOT NULL,
    typ text DEFAULT 'PKW'::text NOT NULL,
    marke text,
    modell text,
    kennzeichen text,
    baujahr integer,
    hu_datum date,
    notiz text,
    erstellt_am timestamp with time zone DEFAULT now() NOT NULL,
    geaendert_am timestamp with time zone,
    hu_erinnerung_gesendet boolean DEFAULT false
);


--
-- Name: gewerbe_anfragen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gewerbe_anfragen (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    firma text NOT NULL,
    anrede text,
    ansprechpartner text,
    ust_id text,
    telefon text,
    email text NOT NULL,
    anzahl_fahrzeuge integer,
    nachricht text,
    dokument_pfad text,
    dokument_name text,
    datenschutz_ip text,
    erledigt boolean DEFAULT false,
    erstellt_am timestamp with time zone DEFAULT now()
);


--
-- Name: gutschein_regeln; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gutschein_regeln (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    gutschein_id uuid NOT NULL,
    artikel_id uuid,
    rabatt_prozent integer NOT NULL,
    erstellt_am timestamp with time zone DEFAULT now(),
    CONSTRAINT gutschein_regeln_rabatt_prozent_check CHECK (((rabatt_prozent >= 0) AND (rabatt_prozent <= 100)))
);


--
-- Name: gutscheine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gutscheine (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    beschreibung text,
    rabatt_prozent integer NOT NULL,
    gueltig_bis date,
    aktiv boolean DEFAULT true,
    erstellt_am timestamp with time zone DEFAULT now()
);


--
-- Name: homepage_fonts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.homepage_fonts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    label text NOT NULL,
    familie text NOT NULL,
    datei text NOT NULL,
    format text NOT NULL,
    erstellt_am timestamp with time zone DEFAULT now()
);


--
-- Name: homepage_sektionen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.homepage_sektionen (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    typ text DEFAULT 'text'::text NOT NULL,
    sortierung integer DEFAULT 100 NOT NULL,
    sichtbar boolean DEFAULT true NOT NULL,
    headline text,
    subline text,
    inhalt text,
    bild_url text,
    cta_text text,
    cta_url text,
    erstellt_am timestamp with time zone DEFAULT now() NOT NULL,
    geaendert_am timestamp with time zone,
    buchung_artikel_id uuid,
    daten jsonb,
    bild_alt text
);


--
-- Name: kontakt_anfragen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kontakt_anfragen (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    telefon text,
    nachricht text NOT NULL,
    ip text,
    erledigt boolean DEFAULT false,
    erstellt_am timestamp with time zone DEFAULT now()
);


--
-- Name: kunden; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kunden (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    kunden_nr text NOT NULL,
    vorname text NOT NULL,
    nachname text NOT NULL,
    firma text,
    strasse text,
    plz text,
    ort text,
    telefon text,
    telefon2 text,
    email text,
    kennzeichen text,
    fahrzeug_marke text,
    fahrzeug_modell text,
    baujahr integer,
    portal_aktiv boolean DEFAULT false,
    portal_email text,
    portal_password text,
    portal_verifiziert boolean DEFAULT false,
    notizen text,
    aktiv boolean DEFAULT true,
    erstellt_am timestamp with time zone DEFAULT now(),
    geaendert_am timestamp with time zone DEFAULT now(),
    erstellt_von uuid,
    geloescht_am timestamp with time zone,
    portal_agb_akzeptiert boolean DEFAULT false,
    portal_agb_datum timestamp with time zone,
    portal_dsgvo_akzeptiert boolean DEFAULT false,
    portal_dsgvo_datum timestamp with time zone,
    einwilligung_werbung boolean DEFAULT false,
    einwilligung_etikett boolean DEFAULT false,
    widerruf_datum timestamp with time zone,
    loeschung_beantragt_am timestamp with time zone,
    anonymisiert_am timestamp with time zone,
    hu_datum date,
    hu_erinnerung_gesendet boolean DEFAULT false,
    anrede text,
    fahrzeug_typ text DEFAULT 'PKW'::text,
    portal_email_bestaetigt boolean DEFAULT false,
    portal_bestaetigung_token text,
    portal_token_ablauf timestamp with time zone,
    portal_freigegeben boolean DEFAULT false,
    portal_registriert_am timestamp with time zone,
    einwilligung_saison_erinnerung boolean DEFAULT false,
    einwilligung_ip text,
    agb_version text,
    portal_reset_token text,
    portal_reset_ablauf timestamp with time zone,
    passwort_geaendert_am timestamp with time zone,
    ist_gewerbe boolean DEFAULT false,
    grosskunden_rabatt integer DEFAULT 0,
    ust_id text,
    einwilligung_saison_bestaetigt boolean DEFAULT false,
    einwilligung_saison_bestaetigt_am timestamp with time zone,
    einwilligung_token text,
    einwilligung_token_ablauf timestamp with time zone,
    einwilligung_bewertung boolean DEFAULT false,
    einwilligung_bewertung_am timestamp with time zone,
    kundentyp text DEFAULT 'privat'::text NOT NULL,
    land text,
    rechnung_email text,
    CONSTRAINT kunden_kundentyp_check CHECK ((kundentyp = ANY (ARRAY['privat'::text, 'firma'::text])))
);


--
-- Name: kunden_dokumente; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kunden_dokumente (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    kunden_id uuid NOT NULL,
    einlagerung_id uuid,
    typ text NOT NULL,
    titel text NOT NULL,
    inhalt_html text NOT NULL,
    unterschrift_kunde text,
    unterschrift_datum timestamp with time zone,
    erstellt_von uuid,
    erstellt_am timestamp with time zone DEFAULT now(),
    gueltig_bis date,
    version text,
    scan_pfad text,
    unterschrift_weg text,
    CONSTRAINT kunden_dokumente_typ_check CHECK ((typ = ANY (ARRAY['datenschutzerklaerung'::text, 'einlagerungsvertrag'::text, 'einlagerungsschein'::text, 'auslagerungsschein'::text, 'scan'::text, 'sonstiges'::text]))),
    CONSTRAINT kunden_dokumente_unterschrift_weg_check CHECK (((unterschrift_weg IS NULL) OR (unterschrift_weg = ANY (ARRAY['tablet'::text, 'scan'::text]))))
);


--
-- Name: kunden_preise; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kunden_preise (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kunden_id uuid,
    artikel_id uuid,
    preis numeric NOT NULL
);


--
-- Name: lager_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lager_config (
    id integer NOT NULL,
    regale integer DEFAULT 10 NOT NULL,
    reihen integer DEFAULT 10 NOT NULL,
    plaetze integer DEFAULT 10 NOT NULL,
    geaendert_am timestamp with time zone DEFAULT now()
);


--
-- Name: lager_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lager_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lager_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lager_config_id_seq OWNED BY public.lager_config.id;


--
-- Name: lager_orte; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lager_orte (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    beschreibung text,
    aktiv boolean DEFAULT true,
    erstellt_am timestamp with time zone DEFAULT now()
);


--
-- Name: lager_regale; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lager_regale (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ort_id uuid NOT NULL,
    name text NOT NULL,
    plaetze_von integer DEFAULT 1 NOT NULL,
    plaetze_bis integer DEFAULT 10 NOT NULL,
    aktiv boolean DEFAULT true,
    plaetze_kapazitaet integer DEFAULT 1 NOT NULL,
    CONSTRAINT lager_regale_kapazitaet_check CHECK (((plaetze_kapazitaet >= 1) AND (plaetze_kapazitaet <= 4)))
);


--
-- Name: oeffnungszeiten; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oeffnungszeiten (
    wochentag integer NOT NULL,
    geschlossen boolean DEFAULT false,
    von1 time without time zone,
    bis1 time without time zone,
    von2 time without time zone,
    bis2 time without time zone
);


--
-- Name: passwort_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passwort_reset_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    kunden_id uuid,
    token text NOT NULL,
    ablauf_am timestamp with time zone NOT NULL,
    verwendet boolean DEFAULT false,
    erstellt_am timestamp with time zone DEFAULT now(),
    CONSTRAINT entweder_user_oder_kunde CHECK ((((user_id IS NOT NULL) AND (kunden_id IS NULL)) OR ((user_id IS NULL) AND (kunden_id IS NOT NULL))))
);


--
-- Name: protokolle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.protokolle (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    typ text DEFAULT 'annahme'::text NOT NULL,
    kunden_id uuid,
    einlagerung_id uuid,
    kennzeichen text,
    km_stand integer,
    checkliste jsonb,
    maengel text,
    fotos jsonb,
    unterschrift_datei text,
    unterschrift_name text,
    pdf_pfad text,
    erstellt_von uuid,
    erstellt_am timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rechnung_counter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rechnung_counter (
    jahr integer NOT NULL,
    letzte_nr integer DEFAULT 0 NOT NULL
);


--
-- Name: rechnung_positionen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rechnung_positionen (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    rechnung_id uuid NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    bezeichnung text NOT NULL,
    menge numeric(10,2) DEFAULT 1 NOT NULL,
    einheit text,
    einzelpreis_netto numeric(10,2) DEFAULT 0 NOT NULL,
    mwst_satz numeric(4,1) DEFAULT 19 NOT NULL,
    zeilen_netto numeric(10,2) DEFAULT 0 NOT NULL,
    zeilen_brutto numeric(10,2) DEFAULT 0 NOT NULL,
    artikel_id uuid
);


--
-- Name: rechnungen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rechnungen (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    rechnungsnr text,
    status text DEFAULT 'entwurf'::text NOT NULL,
    kunden_id uuid,
    empfaenger_name text,
    empfaenger_firma text,
    empfaenger_strasse text,
    empfaenger_plz text,
    empfaenger_ort text,
    aussteller jsonb,
    rechnungsdatum date,
    leistungsdatum date,
    faelligkeit date,
    netto_summe numeric(10,2) DEFAULT 0 NOT NULL,
    mwst_summe numeric(10,2) DEFAULT 0 NOT NULL,
    brutto_summe numeric(10,2) DEFAULT 0 NOT NULL,
    mwst_aufschluesselung jsonb,
    zahlungsstatus text DEFAULT 'offen'::text NOT NULL,
    bezahlt_am date,
    pdf_pfad text,
    storno_von_id uuid,
    notizen text,
    erstellt_von uuid,
    erstellt_am timestamp with time zone DEFAULT now() NOT NULL,
    festgeschrieben_am timestamp with time zone,
    mahnstufe integer DEFAULT 0,
    mahnung_am date,
    empfaenger_anrede text,
    empfaenger_vorname text,
    empfaenger_nachname text,
    empfaenger_land text,
    kasse_beleg_nr text,
    kasse_beleg_datum date,
    kasse_beleg_url text
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    ablauf_am timestamp with time zone NOT NULL,
    ip_adresse inet,
    erstellt_am timestamp with time zone DEFAULT now()
);


--
-- Name: sektion_historie; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sektion_historie (
    id bigint NOT NULL,
    sektion_id uuid,
    daten jsonb,
    beschreibung text,
    geaendert_am timestamp with time zone DEFAULT now()
);


--
-- Name: sektion_historie_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sektion_historie_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sektion_historie_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sektion_historie_id_seq OWNED BY public.sektion_historie.id;


--
-- Name: seq_beleg_nr; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_beleg_nr
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_kunden_nr; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_kunden_nr
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: signatur_auftraege; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signatur_auftraege (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    station_id uuid NOT NULL,
    titel text NOT NULL,
    kunde_name text,
    inhalt_html text NOT NULL,
    unterschrift text,
    status text DEFAULT 'offen'::text NOT NULL,
    erstellt_von uuid,
    erstellt_am timestamp with time zone DEFAULT now() NOT NULL,
    erledigt_am timestamp with time zone,
    ablauf_am timestamp with time zone NOT NULL
);


--
-- Name: signatur_stationen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signatur_stationen (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    geheimnis text NOT NULL,
    kopplungscode text,
    code_ablauf timestamp with time zone,
    gekoppelt_am timestamp with time zone,
    letzter_kontakt timestamp with time zone,
    aktiv boolean DEFAULT true NOT NULL,
    erstellt_am timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: termine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.termine (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    kunden_id uuid,
    kontakt_name text,
    kontakt_telefon text,
    kontakt_email text,
    datum date NOT NULL,
    uhrzeit_von time without time zone NOT NULL,
    uhrzeit_bis time without time zone NOT NULL,
    termin_typ text NOT NULL,
    kennzeichen text,
    beschreibung text,
    status text DEFAULT 'angefragt'::text NOT NULL,
    notizen_intern text,
    erstellt_am timestamp with time zone DEFAULT now(),
    geaendert_am timestamp with time zone DEFAULT now(),
    artikel_id uuid,
    storniert_am timestamp with time zone,
    storniert_von text,
    erinnerung_gesendet boolean DEFAULT false,
    bestaetigung_gesendet boolean DEFAULT false,
    portal_buchung boolean DEFAULT false,
    fahrzeug_id uuid,
    kontakt_anrede text,
    kontakt_vorname text,
    kontakt_nachname text,
    kontakt_strasse text,
    kontakt_plz text,
    kontakt_ort text,
    fahrzeugtyp text,
    leistungen jsonb,
    datenschutz_am timestamp with time zone,
    werbung_einwilligung boolean DEFAULT false,
    rechnung_id uuid,
    bewertung_gesendet boolean DEFAULT false,
    bestaetigung_token text,
    bestaetigung_token_ablauf timestamp with time zone,
    einlagern boolean,
    fakturiert boolean DEFAULT false,
    gutschein_code text,
    gutschein_rabatt integer,
    kontakt_kundentyp text DEFAULT 'privat'::text NOT NULL,
    kontakt_firma text,
    agb_am timestamp with time zone,
    vorzeitige_leistung boolean DEFAULT false NOT NULL,
    vorzeitige_leistung_am timestamp with time zone,
    CONSTRAINT termine_status_check CHECK ((status = ANY (ARRAY['angefragt'::text, 'bestaetigt'::text, 'abgeschlossen'::text, 'storniert'::text, 'abgesagt'::text, 'nicht_erschienen'::text])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    vorname text NOT NULL,
    nachname text NOT NULL,
    rolle text DEFAULT 'mitarbeiter'::text NOT NULL,
    aktiv boolean DEFAULT true,
    letzter_login timestamp with time zone,
    erstellt_am timestamp with time zone DEFAULT now(),
    geaendert_am timestamp with time zone DEFAULT now(),
    passwort_geaendert_am timestamp with time zone,
    CONSTRAINT users_rolle_check CHECK ((rolle = ANY (ARRAY['admin'::text, 'mitarbeiter'::text])))
);


--
-- Name: v_statistiken; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_statistiken AS
 SELECT ( SELECT count(*) AS count
           FROM public.kunden
          WHERE (kunden.aktiv = true)) AS kunden_gesamt,
    ( SELECT count(*) AS count
           FROM public.einlagerungen
          WHERE (einlagerungen.status = 'Eingelagert'::text)) AS eingelagert,
    ( SELECT count(*) AS count
           FROM public.einlagerungen
          WHERE (einlagerungen.status = 'Abholbereit'::text)) AS abholbereit,
    ( SELECT ((lager_config.regale * lager_config.reihen) * lager_config.plaetze)
           FROM public.lager_config
         LIMIT 1) AS kapazitaet,
    (( SELECT ((lager_config.regale * lager_config.reihen) * lager_config.plaetze)
           FROM public.lager_config
         LIMIT 1) - ( SELECT count(*) AS count
           FROM public.einlagerungen
          WHERE (einlagerungen.status = ANY (ARRAY['Eingelagert'::text, 'Abholbereit'::text])))) AS freie_plaetze,
    ( SELECT count(*) AS count
           FROM public.termine
          WHERE ((termine.datum >= CURRENT_DATE) AND (termine.status <> 'storniert'::text))) AS termine_offen;


--
-- Name: einstellungen id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einstellungen ALTER COLUMN id SET DEFAULT nextval('public.einstellungen_id_seq'::regclass);


--
-- Name: lager_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lager_config ALTER COLUMN id SET DEFAULT nextval('public.lager_config_id_seq'::regclass);


--
-- Name: sektion_historie id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sektion_historie ALTER COLUMN id SET DEFAULT nextval('public.sektion_historie_id_seq'::regclass);


--
-- Name: artikel artikel_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artikel
    ADD CONSTRAINT artikel_pkey PRIMARY KEY (id);


--
-- Name: artikel_preise artikel_preise_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artikel_preise
    ADD CONSTRAINT artikel_preise_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: besondere_tage besondere_tage_datum_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.besondere_tage
    ADD CONSTRAINT besondere_tage_datum_key UNIQUE (datum);


--
-- Name: besondere_tage besondere_tage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.besondere_tage
    ADD CONSTRAINT besondere_tage_pkey PRIMARY KEY (id);


--
-- Name: betriebsurlaub betriebsurlaub_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.betriebsurlaub
    ADD CONSTRAINT betriebsurlaub_pkey PRIMARY KEY (id);


--
-- Name: buchung_leistungen buchung_leistungen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buchung_leistungen
    ADD CONSTRAINT buchung_leistungen_pkey PRIMARY KEY (id);


--
-- Name: dokument_scan_token dokument_scan_token_jti_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dokument_scan_token
    ADD CONSTRAINT dokument_scan_token_jti_key UNIQUE (jti);


--
-- Name: dokument_scan_token dokument_scan_token_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dokument_scan_token
    ADD CONSTRAINT dokument_scan_token_pkey PRIMARY KEY (id);


--
-- Name: dsgvo_anfragen dsgvo_anfragen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dsgvo_anfragen
    ADD CONSTRAINT dsgvo_anfragen_pkey PRIMARY KEY (id);


--
-- Name: einlagerung_platz_historie einlagerung_platz_historie_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einlagerung_platz_historie
    ADD CONSTRAINT einlagerung_platz_historie_pkey PRIMARY KEY (id);


--
-- Name: einlagerungen einlagerungen_beleg_nr_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einlagerungen
    ADD CONSTRAINT einlagerungen_beleg_nr_key UNIQUE (beleg_nr);


--
-- Name: einlagerungen einlagerungen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einlagerungen
    ADD CONSTRAINT einlagerungen_pkey PRIMARY KEY (id);


--
-- Name: einstellungen einstellungen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einstellungen
    ADD CONSTRAINT einstellungen_pkey PRIMARY KEY (id);


--
-- Name: email_log email_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_pkey PRIMARY KEY (id);


--
-- Name: fahrzeuge fahrzeuge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fahrzeuge
    ADD CONSTRAINT fahrzeuge_pkey PRIMARY KEY (id);


--
-- Name: gewerbe_anfragen gewerbe_anfragen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gewerbe_anfragen
    ADD CONSTRAINT gewerbe_anfragen_pkey PRIMARY KEY (id);


--
-- Name: gutschein_regeln gutschein_regeln_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gutschein_regeln
    ADD CONSTRAINT gutschein_regeln_pkey PRIMARY KEY (id);


--
-- Name: gutscheine gutscheine_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gutscheine
    ADD CONSTRAINT gutscheine_code_key UNIQUE (code);


--
-- Name: gutscheine gutscheine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gutscheine
    ADD CONSTRAINT gutscheine_pkey PRIMARY KEY (id);


--
-- Name: homepage_fonts homepage_fonts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.homepage_fonts
    ADD CONSTRAINT homepage_fonts_pkey PRIMARY KEY (id);


--
-- Name: homepage_sektionen homepage_sektionen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.homepage_sektionen
    ADD CONSTRAINT homepage_sektionen_pkey PRIMARY KEY (id);


--
-- Name: kontakt_anfragen kontakt_anfragen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kontakt_anfragen
    ADD CONSTRAINT kontakt_anfragen_pkey PRIMARY KEY (id);


--
-- Name: kunden_dokumente kunden_dokumente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kunden_dokumente
    ADD CONSTRAINT kunden_dokumente_pkey PRIMARY KEY (id);


--
-- Name: kunden kunden_kunden_nr_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kunden
    ADD CONSTRAINT kunden_kunden_nr_key UNIQUE (kunden_nr);


--
-- Name: kunden kunden_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kunden
    ADD CONSTRAINT kunden_pkey PRIMARY KEY (id);


--
-- Name: kunden_preise kunden_preise_kunden_id_artikel_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kunden_preise
    ADD CONSTRAINT kunden_preise_kunden_id_artikel_id_key UNIQUE (kunden_id, artikel_id);


--
-- Name: kunden_preise kunden_preise_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kunden_preise
    ADD CONSTRAINT kunden_preise_pkey PRIMARY KEY (id);


--
-- Name: lager_config lager_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lager_config
    ADD CONSTRAINT lager_config_pkey PRIMARY KEY (id);


--
-- Name: lager_orte lager_orte_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lager_orte
    ADD CONSTRAINT lager_orte_pkey PRIMARY KEY (id);


--
-- Name: lager_regale lager_regale_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lager_regale
    ADD CONSTRAINT lager_regale_pkey PRIMARY KEY (id);


--
-- Name: oeffnungszeiten oeffnungszeiten_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oeffnungszeiten
    ADD CONSTRAINT oeffnungszeiten_pkey PRIMARY KEY (wochentag);


--
-- Name: passwort_reset_tokens passwort_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passwort_reset_tokens
    ADD CONSTRAINT passwort_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: passwort_reset_tokens passwort_reset_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passwort_reset_tokens
    ADD CONSTRAINT passwort_reset_tokens_token_key UNIQUE (token);


--
-- Name: protokolle protokolle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.protokolle
    ADD CONSTRAINT protokolle_pkey PRIMARY KEY (id);


--
-- Name: rechnung_counter rechnung_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rechnung_counter
    ADD CONSTRAINT rechnung_counter_pkey PRIMARY KEY (jahr);


--
-- Name: rechnung_positionen rechnung_positionen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rechnung_positionen
    ADD CONSTRAINT rechnung_positionen_pkey PRIMARY KEY (id);


--
-- Name: rechnungen rechnungen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rechnungen
    ADD CONSTRAINT rechnungen_pkey PRIMARY KEY (id);


--
-- Name: rechnungen rechnungen_rechnungsnr_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rechnungen
    ADD CONSTRAINT rechnungen_rechnungsnr_key UNIQUE (rechnungsnr);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_key UNIQUE (token);


--
-- Name: sektion_historie sektion_historie_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sektion_historie
    ADD CONSTRAINT sektion_historie_pkey PRIMARY KEY (id);


--
-- Name: signatur_auftraege signatur_auftraege_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatur_auftraege
    ADD CONSTRAINT signatur_auftraege_pkey PRIMARY KEY (id);


--
-- Name: signatur_stationen signatur_stationen_geheimnis_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatur_stationen
    ADD CONSTRAINT signatur_stationen_geheimnis_key UNIQUE (geheimnis);


--
-- Name: signatur_stationen signatur_stationen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatur_stationen
    ADD CONSTRAINT signatur_stationen_pkey PRIMARY KEY (id);


--
-- Name: termine termine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.termine
    ADD CONSTRAINT termine_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_artikel_preise_artikel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artikel_preise_artikel ON public.artikel_preise USING btree (artikel_id);


--
-- Name: idx_dokumente_einlagerung_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dokumente_einlagerung_id ON public.kunden_dokumente USING btree (einlagerung_id);


--
-- Name: idx_dokumente_kunden_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dokumente_kunden_id ON public.kunden_dokumente USING btree (kunden_id);


--
-- Name: idx_dokumente_typ; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dokumente_typ ON public.kunden_dokumente USING btree (typ);


--
-- Name: idx_dsgvo_kunden_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dsgvo_kunden_id ON public.dsgvo_anfragen USING btree (kunden_id);


--
-- Name: idx_dsgvo_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dsgvo_status ON public.dsgvo_anfragen USING btree (status);


--
-- Name: idx_einl_kunden_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_einl_kunden_id ON public.einlagerungen USING btree (kunden_id);


--
-- Name: idx_einl_lagerplatz; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_einl_lagerplatz ON public.einlagerungen USING btree (lagerplatz);


--
-- Name: idx_einl_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_einl_status ON public.einlagerungen USING btree (status);


--
-- Name: idx_einl_vorgaenger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_einl_vorgaenger ON public.einlagerungen USING btree (vorgaenger_id);


--
-- Name: idx_fahrzeuge_kunde; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fahrzeuge_kunde ON public.fahrzeuge USING btree (kunden_id);


--
-- Name: idx_gutschein_regel_artikel; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_gutschein_regel_artikel ON public.gutschein_regeln USING btree (gutschein_id, artikel_id) WHERE (artikel_id IS NOT NULL);


--
-- Name: idx_gutschein_regel_auffang; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_gutschein_regel_auffang ON public.gutschein_regeln USING btree (gutschein_id) WHERE (artikel_id IS NULL);


--
-- Name: idx_gutschein_regeln_gutschein; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gutschein_regeln_gutschein ON public.gutschein_regeln USING btree (gutschein_id);


--
-- Name: idx_kunden_kennzeichen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kunden_kennzeichen ON public.kunden USING btree (kennzeichen);


--
-- Name: idx_kunden_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kunden_name ON public.kunden USING btree (nachname, vorname);


--
-- Name: idx_kunden_portal_email_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_kunden_portal_email_uniq ON public.kunden USING btree (lower(portal_email)) WHERE ((portal_email IS NOT NULL) AND (portal_email <> ''::text));


--
-- Name: idx_kunden_telefon; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kunden_telefon ON public.kunden USING btree (telefon);


--
-- Name: idx_lager_regale_ort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lager_regale_ort ON public.lager_regale USING btree (ort_id);


--
-- Name: idx_platz_historie_einlagerung; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platz_historie_einlagerung ON public.einlagerung_platz_historie USING btree (einlagerung_id);


--
-- Name: idx_platz_historie_platz; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platz_historie_platz ON public.einlagerung_platz_historie USING btree (lagerplatz);


--
-- Name: idx_protokolle_einl; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_protokolle_einl ON public.protokolle USING btree (einlagerung_id);


--
-- Name: idx_protokolle_kunde; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_protokolle_kunde ON public.protokolle USING btree (kunden_id);


--
-- Name: idx_prt_kunden_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prt_kunden_id ON public.passwort_reset_tokens USING btree (kunden_id);


--
-- Name: idx_prt_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prt_token ON public.passwort_reset_tokens USING btree (token);


--
-- Name: idx_prt_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prt_user_id ON public.passwort_reset_tokens USING btree (user_id);


--
-- Name: idx_rechnung_positionen_rid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rechnung_positionen_rid ON public.rechnung_positionen USING btree (rechnung_id);


--
-- Name: idx_scan_token_dokument; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scan_token_dokument ON public.dokument_scan_token USING btree (dokument_id) WHERE (verbraucht_am IS NULL);


--
-- Name: idx_sig_auftrag_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sig_auftrag_station ON public.signatur_auftraege USING btree (station_id, status);


--
-- Name: idx_termine_bestaetigung_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_termine_bestaetigung_token ON public.termine USING btree (bestaetigung_token) WHERE (bestaetigung_token IS NOT NULL);


--
-- Name: idx_termine_datum; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_termine_datum ON public.termine USING btree (datum);


--
-- Name: idx_termine_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_termine_status ON public.termine USING btree (status);


--
-- Name: kunden_dokumente trg_dokument_schutz; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dokument_schutz BEFORE DELETE OR UPDATE ON public.kunden_dokumente FOR EACH ROW EXECUTE FUNCTION public.dokument_schutz();


--
-- Name: einlagerungen trg_einl_ts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_einl_ts BEFORE UPDATE ON public.einlagerungen FOR EACH ROW EXECUTE FUNCTION public.update_geaendert_am();


--
-- Name: kunden trg_kunden_ts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_kunden_ts BEFORE UPDATE ON public.kunden FOR EACH ROW EXECUTE FUNCTION public.update_geaendert_am();


--
-- Name: rechnung_positionen trg_rechnung_pos_schutz; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rechnung_pos_schutz BEFORE DELETE OR UPDATE ON public.rechnung_positionen FOR EACH ROW EXECUTE FUNCTION public.rechnung_pos_schutz();


--
-- Name: rechnungen trg_rechnung_schutz; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rechnung_schutz BEFORE DELETE OR UPDATE ON public.rechnungen FOR EACH ROW EXECUTE FUNCTION public.rechnung_schutz();


--
-- Name: termine trg_termine_ts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_termine_ts BEFORE UPDATE ON public.termine FOR EACH ROW EXECUTE FUNCTION public.update_geaendert_am();


--
-- Name: users trg_users_ts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_ts BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_geaendert_am();


--
-- Name: artikel_preise artikel_preise_artikel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artikel_preise
    ADD CONSTRAINT artikel_preise_artikel_id_fkey FOREIGN KEY (artikel_id) REFERENCES public.artikel(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: buchung_leistungen buchung_leistungen_artikel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buchung_leistungen
    ADD CONSTRAINT buchung_leistungen_artikel_id_fkey FOREIGN KEY (artikel_id) REFERENCES public.artikel(id) ON DELETE CASCADE;


--
-- Name: dokument_scan_token dokument_scan_token_dokument_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dokument_scan_token
    ADD CONSTRAINT dokument_scan_token_dokument_id_fkey FOREIGN KEY (dokument_id) REFERENCES public.kunden_dokumente(id) ON DELETE CASCADE;


--
-- Name: dsgvo_anfragen dsgvo_anfragen_bearbeitet_von_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dsgvo_anfragen
    ADD CONSTRAINT dsgvo_anfragen_bearbeitet_von_fkey FOREIGN KEY (bearbeitet_von) REFERENCES public.users(id);


--
-- Name: dsgvo_anfragen dsgvo_anfragen_kunden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dsgvo_anfragen
    ADD CONSTRAINT dsgvo_anfragen_kunden_id_fkey FOREIGN KEY (kunden_id) REFERENCES public.kunden(id) ON DELETE CASCADE;


--
-- Name: einlagerung_platz_historie einlagerung_platz_historie_einlagerung_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einlagerung_platz_historie
    ADD CONSTRAINT einlagerung_platz_historie_einlagerung_id_fkey FOREIGN KEY (einlagerung_id) REFERENCES public.einlagerungen(id) ON DELETE CASCADE;


--
-- Name: einlagerung_platz_historie einlagerung_platz_historie_geaendert_von_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einlagerung_platz_historie
    ADD CONSTRAINT einlagerung_platz_historie_geaendert_von_fkey FOREIGN KEY (geaendert_von) REFERENCES public.users(id);


--
-- Name: einlagerungen einlagerungen_erstellt_von_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einlagerungen
    ADD CONSTRAINT einlagerungen_erstellt_von_fkey FOREIGN KEY (erstellt_von) REFERENCES public.users(id);


--
-- Name: einlagerungen einlagerungen_fahrzeug_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einlagerungen
    ADD CONSTRAINT einlagerungen_fahrzeug_id_fkey FOREIGN KEY (fahrzeug_id) REFERENCES public.fahrzeuge(id);


--
-- Name: einlagerungen einlagerungen_geaendert_von_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einlagerungen
    ADD CONSTRAINT einlagerungen_geaendert_von_fkey FOREIGN KEY (geaendert_von) REFERENCES public.users(id);


--
-- Name: einlagerungen einlagerungen_kunden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einlagerungen
    ADD CONSTRAINT einlagerungen_kunden_id_fkey FOREIGN KEY (kunden_id) REFERENCES public.kunden(id) ON DELETE RESTRICT;


--
-- Name: einlagerungen einlagerungen_vorgaenger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.einlagerungen
    ADD CONSTRAINT einlagerungen_vorgaenger_id_fkey FOREIGN KEY (vorgaenger_id) REFERENCES public.einlagerungen(id) ON DELETE SET NULL;


--
-- Name: fahrzeuge fahrzeuge_kunden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fahrzeuge
    ADD CONSTRAINT fahrzeuge_kunden_id_fkey FOREIGN KEY (kunden_id) REFERENCES public.kunden(id) ON DELETE RESTRICT;


--
-- Name: gutschein_regeln gutschein_regeln_artikel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gutschein_regeln
    ADD CONSTRAINT gutschein_regeln_artikel_id_fkey FOREIGN KEY (artikel_id) REFERENCES public.artikel(id) ON DELETE CASCADE;


--
-- Name: gutschein_regeln gutschein_regeln_gutschein_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gutschein_regeln
    ADD CONSTRAINT gutschein_regeln_gutschein_id_fkey FOREIGN KEY (gutschein_id) REFERENCES public.gutscheine(id) ON DELETE CASCADE;


--
-- Name: kunden_dokumente kunden_dokumente_einlagerung_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kunden_dokumente
    ADD CONSTRAINT kunden_dokumente_einlagerung_id_fkey FOREIGN KEY (einlagerung_id) REFERENCES public.einlagerungen(id) ON DELETE SET NULL;


--
-- Name: kunden_dokumente kunden_dokumente_erstellt_von_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kunden_dokumente
    ADD CONSTRAINT kunden_dokumente_erstellt_von_fkey FOREIGN KEY (erstellt_von) REFERENCES public.users(id);


--
-- Name: kunden_dokumente kunden_dokumente_kunden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kunden_dokumente
    ADD CONSTRAINT kunden_dokumente_kunden_id_fkey FOREIGN KEY (kunden_id) REFERENCES public.kunden(id) ON DELETE CASCADE;


--
-- Name: kunden kunden_erstellt_von_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kunden
    ADD CONSTRAINT kunden_erstellt_von_fkey FOREIGN KEY (erstellt_von) REFERENCES public.users(id);


--
-- Name: kunden_preise kunden_preise_artikel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kunden_preise
    ADD CONSTRAINT kunden_preise_artikel_id_fkey FOREIGN KEY (artikel_id) REFERENCES public.artikel(id) ON DELETE CASCADE;


--
-- Name: kunden_preise kunden_preise_kunden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kunden_preise
    ADD CONSTRAINT kunden_preise_kunden_id_fkey FOREIGN KEY (kunden_id) REFERENCES public.kunden(id) ON DELETE CASCADE;


--
-- Name: lager_regale lager_regale_ort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lager_regale
    ADD CONSTRAINT lager_regale_ort_id_fkey FOREIGN KEY (ort_id) REFERENCES public.lager_orte(id) ON DELETE CASCADE;


--
-- Name: passwort_reset_tokens passwort_reset_tokens_kunden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passwort_reset_tokens
    ADD CONSTRAINT passwort_reset_tokens_kunden_id_fkey FOREIGN KEY (kunden_id) REFERENCES public.kunden(id) ON DELETE CASCADE;


--
-- Name: passwort_reset_tokens passwort_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passwort_reset_tokens
    ADD CONSTRAINT passwort_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: protokolle protokolle_einlagerung_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.protokolle
    ADD CONSTRAINT protokolle_einlagerung_id_fkey FOREIGN KEY (einlagerung_id) REFERENCES public.einlagerungen(id);


--
-- Name: protokolle protokolle_kunden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.protokolle
    ADD CONSTRAINT protokolle_kunden_id_fkey FOREIGN KEY (kunden_id) REFERENCES public.kunden(id);


--
-- Name: rechnung_positionen rechnung_positionen_rechnung_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rechnung_positionen
    ADD CONSTRAINT rechnung_positionen_rechnung_id_fkey FOREIGN KEY (rechnung_id) REFERENCES public.rechnungen(id) ON DELETE CASCADE;


--
-- Name: rechnungen rechnungen_erstellt_von_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rechnungen
    ADD CONSTRAINT rechnungen_erstellt_von_fkey FOREIGN KEY (erstellt_von) REFERENCES public.users(id);


--
-- Name: rechnungen rechnungen_kunden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rechnungen
    ADD CONSTRAINT rechnungen_kunden_id_fkey FOREIGN KEY (kunden_id) REFERENCES public.kunden(id);


--
-- Name: rechnungen rechnungen_storno_von_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rechnungen
    ADD CONSTRAINT rechnungen_storno_von_id_fkey FOREIGN KEY (storno_von_id) REFERENCES public.rechnungen(id);


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: signatur_auftraege signatur_auftraege_erstellt_von_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatur_auftraege
    ADD CONSTRAINT signatur_auftraege_erstellt_von_fkey FOREIGN KEY (erstellt_von) REFERENCES public.users(id);


--
-- Name: signatur_auftraege signatur_auftraege_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatur_auftraege
    ADD CONSTRAINT signatur_auftraege_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.signatur_stationen(id) ON DELETE CASCADE;


--
-- Name: termine termine_artikel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.termine
    ADD CONSTRAINT termine_artikel_id_fkey FOREIGN KEY (artikel_id) REFERENCES public.artikel(id);


--
-- Name: termine termine_fahrzeug_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.termine
    ADD CONSTRAINT termine_fahrzeug_id_fkey FOREIGN KEY (fahrzeug_id) REFERENCES public.fahrzeuge(id);


--
-- Name: termine termine_kunden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.termine
    ADD CONSTRAINT termine_kunden_id_fkey FOREIGN KEY (kunden_id) REFERENCES public.kunden(id) ON DELETE SET NULL;


--
-- Name: termine termine_rechnung_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.termine
    ADD CONSTRAINT termine_rechnung_id_fkey FOREIGN KEY (rechnung_id) REFERENCES public.rechnungen(id);


--
-- PostgreSQL database dump complete
--

\unrestrict di4F3LexMlj0xxXpa0HwqCopMXoSbixuKjbZcX617qqQlGCIgvLOMAoN2JBdlo7



-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Zugriffsrechte fuer den Anwendungsnutzer.
-- npm run migrate laeuft ueber den Pool aus der .env, also bereits als reifenpro_user —
-- dann gehoeren die Objekte ihm und diese Rechte sind ueberfluessig. Wird die Struktur aber
-- als postgres eingespielt (Wiederherstellung, neuer Server), fehlen sie sonst und die
-- Anwendung kaeme nicht an ihre eigenen Tabellen. Der Block laeuft ins Leere, wenn es die
-- Rolle nicht gibt — der Cluster wird mit anderen Projekten geteilt, ein hartes GRANT auf
-- eine fehlende Rolle wuerde den ganzen Aufbau abbrechen.
-- ═══════════════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reifenpro_user') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO reifenpro_user';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO reifenpro_user';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO reifenpro_user';
  END IF;
END $$;
