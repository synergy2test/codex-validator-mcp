/**
 * Technology Detector Utility
 *
 * Detects technologies, frameworks, and libraries mentioned in plan content
 * by analyzing:
 * - Import statements (ES6, CommonJS, Python, Go, etc.)
 * - Package.json references
 * - Framework-specific keywords and patterns
 * - Configuration file references
 */

export interface DetectedTechnology {
  name: string;
  category: TechnologyCategory;
  confidence: number; // 0-1
  evidence: string[];
}

export type TechnologyCategory =
  | 'frontend-framework'
  | 'backend-framework'
  | 'database'
  | 'language'
  | 'build-tool'
  | 'testing'
  | 'cloud'
  | 'devops'
  | 'library'
  | 'other';

interface TechnologyPattern {
  name: string;
  category: TechnologyCategory;
  patterns: RegExp[];
  keywords: string[];
  filePatterns?: RegExp[];
}

// Define technology detection patterns
const TECHNOLOGY_PATTERNS: TechnologyPattern[] = [
  // Frontend Frameworks
  {
    name: 'React',
    category: 'frontend-framework',
    patterns: [
      /import\s+.*\s+from\s+['"]react['"]/i,
      /require\s*\(\s*['"]react['"]\s*\)/i,
      /from\s+['"]react['"]/i,
    ],
    keywords: ['react', 'jsx', 'tsx', 'usestate', 'useeffect', 'hooks', 'component'],
    filePatterns: [/\.jsx$/, /\.tsx$/],
  },
  {
    name: 'Vue.js',
    category: 'frontend-framework',
    patterns: [
      /import\s+.*\s+from\s+['"]vue['"]/i,
      /require\s*\(\s*['"]vue['"]\s*\)/i,
    ],
    keywords: ['vue', 'vuex', 'pinia', 'composition api', 'v-model', 'v-bind'],
    filePatterns: [/\.vue$/],
  },
  {
    name: 'Angular',
    category: 'frontend-framework',
    patterns: [
      /import\s+.*\s+from\s+['"]@angular\//i,
    ],
    keywords: ['angular', 'ng-', 'ngmodule', 'component', 'injectable', '@angular'],
  },
  {
    name: 'Next.js',
    category: 'frontend-framework',
    patterns: [
      /import\s+.*\s+from\s+['"]next\//i,
      /from\s+['"]next['"]/i,
    ],
    keywords: ['next.js', 'nextjs', 'getserversideprops', 'getstaticprops', 'app router', 'pages router'],
  },
  {
    name: 'Svelte',
    category: 'frontend-framework',
    patterns: [
      /import\s+.*\s+from\s+['"]svelte['"]/i,
    ],
    keywords: ['svelte', 'sveltekit', '$:'],
    filePatterns: [/\.svelte$/],
  },

  // Backend Frameworks
  {
    name: 'FastAPI',
    category: 'backend-framework',
    patterns: [
      /from\s+fastapi\s+import/i,
      /import\s+fastapi/i,
    ],
    keywords: ['fastapi', 'pydantic', 'uvicorn', '@app.get', '@app.post'],
  },
  {
    name: 'Express.js',
    category: 'backend-framework',
    patterns: [
      /require\s*\(\s*['"]express['"]\s*\)/i,
      /import\s+.*\s+from\s+['"]express['"]/i,
    ],
    keywords: ['express', 'middleware', 'app.use', 'app.get', 'app.post', 'router'],
  },
  {
    name: 'Django',
    category: 'backend-framework',
    patterns: [
      /from\s+django\s+import/i,
      /import\s+django/i,
    ],
    keywords: ['django', 'django rest framework', 'drf', 'models.py', 'views.py', 'urlconf'],
  },
  {
    name: 'Flask',
    category: 'backend-framework',
    patterns: [
      /from\s+flask\s+import/i,
      /import\s+flask/i,
    ],
    keywords: ['flask', '@app.route', 'blueprint'],
  },
  {
    name: 'NestJS',
    category: 'backend-framework',
    patterns: [
      /import\s+.*\s+from\s+['"]@nestjs\//i,
    ],
    keywords: ['nestjs', '@controller', '@injectable', '@module'],
  },

  // Databases
  {
    name: 'PostgreSQL',
    category: 'database',
    patterns: [
      /import\s+.*\s+from\s+['"]pg['"]/i,
      /require\s*\(\s*['"]pg['"]\s*\)/i,
    ],
    keywords: ['postgresql', 'postgres', 'psql', 'pg_'],
  },
  {
    name: 'MongoDB',
    category: 'database',
    patterns: [
      /import\s+.*\s+from\s+['"]mongodb['"]/i,
      /import\s+.*\s+from\s+['"]mongoose['"]/i,
    ],
    keywords: ['mongodb', 'mongoose', 'nosql', 'collection'],
  },
  {
    name: 'Redis',
    category: 'database',
    patterns: [
      /import\s+.*\s+from\s+['"]redis['"]/i,
      /import\s+.*\s+from\s+['"]ioredis['"]/i,
    ],
    keywords: ['redis', 'cache', 'ioredis'],
  },
  {
    name: 'SQLite',
    category: 'database',
    patterns: [
      /import\s+sqlite3/i,
      /import\s+.*\s+from\s+['"]better-sqlite3['"]/i,
    ],
    keywords: ['sqlite', 'sqlite3'],
  },

  // Languages
  {
    name: 'TypeScript',
    category: 'language',
    patterns: [],
    keywords: ['typescript', 'ts', 'interface', 'type', 'generic'],
    filePatterns: [/\.ts$/, /\.tsx$/, /tsconfig\.json$/],
  },
  {
    name: 'Python',
    category: 'language',
    patterns: [
      /^import\s+\w+/m,
      /^from\s+\w+\s+import/m,
    ],
    keywords: ['python', 'pip', 'requirements.txt', 'pyproject.toml', 'venv'],
    filePatterns: [/\.py$/],
  },
  {
    name: 'Go',
    category: 'language',
    patterns: [
      /^package\s+\w+/m,
      /^import\s+\(/m,
    ],
    keywords: ['golang', 'go mod', 'goroutine', 'go.mod'],
    filePatterns: [/\.go$/],
  },
  {
    name: 'Rust',
    category: 'language',
    patterns: [
      /^use\s+\w+::/m,
      /^mod\s+\w+;/m,
    ],
    keywords: ['rust', 'cargo', 'crate', 'cargo.toml'],
    filePatterns: [/\.rs$/],
  },

  // Build Tools
  {
    name: 'Vite',
    category: 'build-tool',
    patterns: [
      /import\s+.*\s+from\s+['"]vite['"]/i,
    ],
    keywords: ['vite', 'vite.config'],
    filePatterns: [/vite\.config\.(js|ts)$/],
  },
  {
    name: 'Webpack',
    category: 'build-tool',
    patterns: [
      /require\s*\(\s*['"]webpack['"]\s*\)/i,
    ],
    keywords: ['webpack', 'bundle', 'loader'],
    filePatterns: [/webpack\.config\.(js|ts)$/],
  },

  // Testing
  {
    name: 'Jest',
    category: 'testing',
    patterns: [
      /import\s+.*\s+from\s+['"]@jest\//i,
    ],
    keywords: ['jest', 'describe', 'it', 'expect', 'mock', 'beforeeach', 'aftereach'],
    filePatterns: [/\.test\.(js|ts|jsx|tsx)$/, /\.spec\.(js|ts|jsx|tsx)$/],
  },
  {
    name: 'Pytest',
    category: 'testing',
    patterns: [
      /import\s+pytest/i,
    ],
    keywords: ['pytest', 'fixture', 'parametrize', 'conftest'],
    filePatterns: [/test_.*\.py$/, /.*_test\.py$/],
  },
  {
    name: 'Playwright',
    category: 'testing',
    patterns: [
      /import\s+.*\s+from\s+['"]@playwright\//i,
    ],
    keywords: ['playwright', 'e2e', 'browser', 'page.goto'],
  },

  // Cloud & DevOps
  {
    name: 'Docker',
    category: 'devops',
    patterns: [],
    keywords: ['docker', 'dockerfile', 'container', 'docker-compose'],
    filePatterns: [/Dockerfile$/, /docker-compose\.ya?ml$/],
  },
  {
    name: 'Kubernetes',
    category: 'cloud',
    patterns: [],
    keywords: ['kubernetes', 'k8s', 'kubectl', 'pod', 'deployment', 'service'],
    filePatterns: [/\.ya?ml$/, /k8s/],
  },
  {
    name: 'AWS',
    category: 'cloud',
    patterns: [
      /import\s+.*\s+from\s+['"]@aws-sdk\//i,
    ],
    keywords: ['aws', 'lambda', 's3', 'ec2', 'dynamodb', 'cloudformation', 'cdk'],
  },

  // Common Libraries
  {
    name: 'TanStack Query',
    category: 'library',
    patterns: [
      /import\s+.*\s+from\s+['"]@tanstack\/react-query['"]/i,
    ],
    keywords: ['tanstack query', 'react query', 'usequery', 'usemutation'],
  },
  {
    name: 'Tailwind CSS',
    category: 'library',
    patterns: [],
    keywords: ['tailwind', 'tailwindcss', 'utility-first'],
    filePatterns: [/tailwind\.config\.(js|ts)$/],
  },
  {
    name: 'Prisma',
    category: 'library',
    patterns: [
      /import\s+.*\s+from\s+['"]@prisma\/client['"]/i,
    ],
    keywords: ['prisma', 'prisma client', 'prisma schema'],
    filePatterns: [/schema\.prisma$/],
  },
  {
    name: 'Zod',
    category: 'library',
    patterns: [
      /import\s+.*\s+from\s+['"]zod['"]/i,
    ],
    keywords: ['zod', 'z.object', 'z.string', 'schema validation'],
  },
];

/**
 * Detect technologies mentioned in plan content
 */
export function detectTechnologies(content: string): DetectedTechnology[] {
  const detected: Map<string, DetectedTechnology> = new Map();
  const contentLower = content.toLowerCase();

  for (const tech of TECHNOLOGY_PATTERNS) {
    const evidence: string[] = [];
    let confidence = 0;

    // Check import/require patterns
    for (const pattern of tech.patterns) {
      const match = content.match(pattern);
      if (match) {
        evidence.push(`Import found: ${match[0].slice(0, 50)}`);
        confidence += 0.4;
      }
    }

    // Check keywords
    for (const keyword of tech.keywords) {
      if (contentLower.includes(keyword.toLowerCase())) {
        evidence.push(`Keyword found: "${keyword}"`);
        confidence += 0.2;
      }
    }

    // Check file patterns (if mentioned in plan)
    if (tech.filePatterns) {
      for (const pattern of tech.filePatterns) {
        const patternStr = pattern.source.replace(/\\/g, '').replace(/\$/g, '');
        if (contentLower.includes(patternStr.toLowerCase())) {
          evidence.push(`File pattern found: ${patternStr}`);
          confidence += 0.15;
        }
      }
    }

    // Only include if we have some evidence
    if (evidence.length > 0) {
      // Cap confidence at 1.0
      confidence = Math.min(1, confidence);

      // Only include if confidence is above threshold
      if (confidence >= 0.2) {
        detected.set(tech.name, {
          name: tech.name,
          category: tech.category,
          confidence,
          evidence,
        });
      }
    }
  }

  // Sort by confidence
  return Array.from(detected.values()).sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get unique technology names for Context7 queries
 */
export function getTechnologyNames(detected: DetectedTechnology[]): string[] {
  return detected.map(t => t.name);
}

/**
 * Filter technologies by category
 */
export function filterByCategory(
  detected: DetectedTechnology[],
  category: TechnologyCategory
): DetectedTechnology[] {
  return detected.filter(t => t.category === category);
}

/**
 * Get primary technologies (highest confidence per category)
 */
export function getPrimaryTechnologies(detected: DetectedTechnology[]): DetectedTechnology[] {
  const byCategory = new Map<TechnologyCategory, DetectedTechnology>();

  for (const tech of detected) {
    const existing = byCategory.get(tech.category);
    if (!existing || tech.confidence > existing.confidence) {
      byCategory.set(tech.category, tech);
    }
  }

  return Array.from(byCategory.values());
}

/**
 * Generate a summary of detected technologies
 */
export function generateTechSummary(detected: DetectedTechnology[]): string {
  if (detected.length === 0) {
    return 'No specific technologies detected.';
  }

  const byCategory = new Map<TechnologyCategory, DetectedTechnology[]>();
  for (const tech of detected) {
    const list = byCategory.get(tech.category) ?? [];
    list.push(tech);
    byCategory.set(tech.category, list);
  }

  const lines: string[] = ['Detected Technologies:'];
  for (const [category, techs] of byCategory) {
    const names = techs.map(t => `${t.name} (${Math.round(t.confidence * 100)}%)`).join(', ');
    lines.push(`  ${category}: ${names}`);
  }

  return lines.join('\n');
}
