import type { ReactNode } from 'react'

export interface FormattedAiSummaryProps {
  content: string
  isStreaming?: boolean
}

type MarkdownBlock =
  | {
      type: 'heading'
      level: 1 | 2 | 3
      content: string
    }
  | {
      type: 'paragraph' | 'quote'
      content: string
    }
  | {
      type: 'list'
      items: {
        content: string
        depth: number
        marker: string
        ordered: boolean
      }[]
    }
  | {
      type: 'divider'
    }

const inlineMarkdownPattern =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g

const cleanUnmatchedMarkdown = (value: string) =>
  value
    .replace(/\*\*|__/g, '')
    .replace(/(^|[\s(])\*(?=\S)/g, '$1')
    .replace(/(\S)\*(?=$|[\s).,;:!?])/g, '$1')

const renderInlineMarkdown = (
  content: string,
  keyPrefix: string,
): ReactNode[] => {
  const nodes: ReactNode[] = []
  let cursor = 0

  for (const match of content.matchAll(inlineMarkdownPattern)) {
    const matchIndex = match.index
    if (matchIndex > cursor) {
      nodes.push(
        cleanUnmatchedMarkdown(content.slice(cursor, matchIndex)),
      )
    }

    const token = match[0]
    const key = `${keyPrefix}-${matchIndex}`

    if (
      (token.startsWith('**') && token.endsWith('**')) ||
      (token.startsWith('__') && token.endsWith('__'))
    ) {
      nodes.push(
        <strong key={key} className="font-bold text-ink">
          {token.slice(2, -2)}
        </strong>,
      )
    } else if (
      (token.startsWith('*') && token.endsWith('*')) ||
      (token.startsWith('_') && token.endsWith('_'))
    ) {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      )
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-panel-raised px-1.5 py-0.5 text-[0.9em] font-semibold text-ink"
        >
          {token.slice(1, -1)}
        </code>,
      )
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
      if (linkMatch) {
        nodes.push(
          <a
            key={key}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {linkMatch[1]}
          </a>,
        )
      }
    }

    cursor = matchIndex + token.length
  }

  if (cursor < content.length) {
    nodes.push(cleanUnmatchedMarkdown(content.slice(cursor)))
  }

  return nodes
}

const parseMarkdownBlocks = (content: string): MarkdownBlock[] => {
  const blocks: MarkdownBlock[] = []
  let paragraphLines: string[] = []
  let listItems: Extract<MarkdownBlock, { type: 'list' }>['items'] = []

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return
    blocks.push({
      type: 'paragraph',
      content: paragraphLines.join(' '),
    })
    paragraphLines = []
  }

  const flushList = () => {
    if (listItems.length === 0) return
    blocks.push({ type: 'list', items: listItems })
    listItems = []
  }

  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3,
        content: headingMatch[2].trim(),
      })
      continue
    }

    if (/^(---+|___+|\*\*\*+)$/.test(trimmed)) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'divider' })
      continue
    }

    const listMatch = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/)
    if (listMatch) {
      flushParagraph()
      const indentation = listMatch[1].replace(/\t/g, '  ').length
      const marker = listMatch[2]
      listItems.push({
        content: listMatch[3].trim(),
        depth: Math.min(3, Math.floor(indentation / 2)),
        marker,
        ordered: /^\d/.test(marker),
      })
      continue
    }

    if (trimmed.startsWith('> ')) {
      flushParagraph()
      flushList()
      blocks.push({
        type: 'quote',
        content: trimmed.slice(2).trim(),
      })
      continue
    }

    flushList()
    paragraphLines.push(trimmed)
  }

  flushParagraph()
  flushList()
  return blocks
}

export function FormattedAiSummary({
  content,
  isStreaming,
}: FormattedAiSummaryProps) {
  const blocks = parseMarkdownBlocks(content)

  return (
    <div className="max-w-[76ch] font-sans text-ink">
      {blocks.map((block, blockIndex) => {
        const key = `${block.type}-${blockIndex}`

        if (block.type === 'heading' && block.level === 1) {
          return (
            <h1
              key={key}
              className="mb-7 border-b border-line pb-5 text-[clamp(1.5rem,4vw,2rem)] font-bold leading-tight tracking-[-0.035em] text-ink"
            >
              {renderInlineMarkdown(block.content, key)}
            </h1>
          )
        }

        if (block.type === 'heading' && block.level === 2) {
          return (
            <h2
              key={key}
              className="mb-3 mt-8 border-t border-line pt-7 text-xl font-bold leading-snug tracking-[-0.025em] text-ink first:mt-0 first:border-t-0 first:pt-0"
            >
              {renderInlineMarkdown(block.content, key)}
            </h2>
          )
        }

        if (block.type === 'heading') {
          return (
            <h3
              key={key}
              className="mb-2 mt-5 text-base font-bold leading-7 text-ink sm:text-lg"
            >
              {renderInlineMarkdown(block.content, key)}
            </h3>
          )
        }

        if (block.type === 'list') {
          return (
            <div
              key={key}
              role="list"
              className="my-3 grid gap-2.5 text-sm leading-7 text-ink-soft sm:text-base"
            >
              {block.items.map((item, itemIndex) => (
                <div
                  key={`${key}-${itemIndex}`}
                  role="listitem"
                  className="flex min-w-0 items-start gap-3"
                  style={{
                    paddingInlineStart: `${item.depth * 1.25}rem`,
                  }}
                >
                  <span
                    className={
                      item.ordered
                        ? 'w-5 shrink-0 text-right font-semibold tabular-nums text-muted'
                        : 'mt-[0.72rem] size-1.5 shrink-0 rounded-full bg-primary'
                    }
                    aria-hidden="true"
                  >
                    {item.ordered ? item.marker.replace(/[.)]$/, '') : ''}
                  </span>
                  <span className="min-w-0 flex-1 break-words">
                    {renderInlineMarkdown(
                      item.content,
                      `${key}-${itemIndex}`,
                    )}
                  </span>
                </div>
              ))}
            </div>
          )
        }

        if (block.type === 'quote') {
          return (
            <blockquote
              key={key}
              className="my-4 border-l-2 border-line-strong pl-4 text-sm italic leading-7 text-muted-strong sm:text-base"
            >
              {renderInlineMarkdown(block.content, key)}
            </blockquote>
          )
        }

        if (block.type === 'divider') {
          return <hr key={key} className="my-7 border-0 border-t border-line" />
        }

        return (
          <p
            key={key}
            className="my-3 break-words text-sm leading-7 text-ink-soft sm:text-base sm:leading-8"
          >
            {renderInlineMarkdown(block.content, key)}
          </p>
        )
      })}
      {isStreaming && (
        <span
          className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-middle"
          aria-hidden="true"
        />
      )}
    </div>
  )
}
