import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'

export const Markdown = ({ children }: { children: string }) => (
  <div className="markdown">
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, rehypeHighlight]}
      components={{
        a: ({ href, children: content }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {content}
          </a>
        ),
        img: ({ src, alt }) => <img src={src} alt={alt || ''} loading="lazy" />,
      }}
    >
      {children}
    </ReactMarkdown>
  </div>
)
