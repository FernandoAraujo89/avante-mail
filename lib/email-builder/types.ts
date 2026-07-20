// Modelo de documento do Criador de email (WYSIWYG).
// O design é a fonte da verdade dos templates visuais; o MJML é gerado dele.

export interface DesignSettings {
  bodyBackground: string;
  contentBackground: string;
  fontFamily: string;
  textColor: string;
  linkColor: string;
}

export interface TextBlock {
  id: string;
  type: "text";
  html: string;
  attrs: {
    fontSize: number;
    color: string; // vazio = herda da configuração global
    align: "left" | "center" | "right";
    padding: string;
  };
}

export interface ImageBlock {
  id: string;
  type: "image";
  src: string;
  alt: string;
  href: string;
  attrs: {
    width: number | null; // null = largura total
    align: "left" | "center" | "right";
    borderRadius: number;
    padding: string;
  };
}

export interface ButtonBlock {
  id: string;
  type: "button";
  text: string;
  href: string;
  attrs: {
    backgroundColor: string;
    color: string;
    fontSize: number;
    borderRadius: number;
    align: "left" | "center" | "right";
    padding: string;
  };
}

export interface SpacerBlock {
  id: string;
  type: "spacer";
  attrs: { height: number };
}

export interface DividerBlock {
  id: string;
  type: "divider";
  attrs: {
    borderColor: string;
    borderWidth: number;
    padding: string;
  };
}

export interface SocialItem {
  label: string;
  iconSrc: string;
  href: string;
}

export interface SocialBlock {
  id: string;
  type: "social";
  items: SocialItem[];
  attrs: {
    iconSize: number;
    align: "left" | "center" | "right";
    padding: string;
  };
}

export type Block =
  | TextBlock
  | ImageBlock
  | ButtonBlock
  | SpacerBlock
  | DividerBlock
  | SocialBlock;

export type BlockType = Block["type"];

export interface Column {
  id: string;
  widthPct: number;
  blocks: Block[];
}

export interface Row {
  id: string;
  columns: Column[];
  attrs: {
    backgroundColor: string; // vazio = herda contentBackground
    padding: string;
  };
}

export interface EmailDesign {
  version: 1;
  settings: DesignSettings;
  rows: Row[];
}

export interface SavedModule {
  id: string;
  name: string;
  design: Row;
  createdAt: string;
}

export type EditorType = "builder" | "code";
