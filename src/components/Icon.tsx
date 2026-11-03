import {
  Activity, Apple, Baby, Bean, Bed, Bone, Brain, BrainCircuit, BrainCog, Bug, Droplet, Droplets, Dna, Dumbbell, Ear, Eye, FileText, FlaskConical,
  Flower, Folder, FolderOpen, HardHat, Heart, HeartPulse, Hand, House, Milestone, PersonStanding, Pill, Ribbon, Scan, ScanFace, Scissors,
  Shield, ShieldCheck, Siren, Smile, Soup, Stethoscope, Syringe, Users, Venus, Wind, type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  stethoscope: Stethoscope, activity: Activity, baby: Baby, siren: Siren, scissors: Scissors, venus: Venus, smile: Smile, eye: Eye, ear: Ear,
  "heart-pulse": HeartPulse, droplets: Droplets, bean: Bean, soup: Soup, wind: Wind, brain: Brain, bone: Bone, hand: Hand, "scan-face": ScanFace,
  "brain-circuit": BrainCircuit, droplet: Droplet, ribbon: Ribbon, bug: Bug, milestone: Milestone, flower: Flower, "person-standing": PersonStanding,
  apple: Apple, shield: Shield, dna: Dna, bed: Bed, users: Users, "hard-hat": HardHat, heart: Heart, "brain-cog": BrainCog, "flask-conical": FlaskConical,
  scan: Scan, pill: Pill, syringe: Syringe, "shield-check": ShieldCheck, house: House, "file-text": FileText, "folder-open": FolderOpen, dumbbell: Dumbbell,
};

export function SpecialtyIcon({ name, size = 20 }: { name: string; size?: number }) {
  const C = MAP[name] ?? Folder;
  return <C size={size} aria-hidden="true" />;
}
