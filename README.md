# WhinJob (Job Hunt Assistant)

WhinJob is an offline-first React Native (Expo) mobile application designed to streamline the job search process. By operating entirely from your device, it queries multiple job providers, securely applies AI models for filtering and scoring, and stores your data locally—all without relying on a central backend server.

## 🚀 Features

- **Decentralized Architecture**: Calls Apify and Amazon Bedrock directly from the device. All reads are from local SQLite storage.
- **Maximum Job Recall**: Uses query fan-out and location aliasing to pull jobs from 6+ platforms including LinkedIn, Naukri, Indeed, Glassdoor, and Foundit.
- **AI-Powered Scoring**: Uses Bedrock models (Claude/OpenAI) to explicitly score job fit (Skills, Experience, Role, Location) based on your parsed resume.
- **Smart Enrichment & Filtering**: Normalizes salaries, discovers direct ATS careers links, and pre-filters junk jobs locally before spending any AI tokens.
- **Automated Apply-Kit**: Automatically generates tailored bullets, cover notes, and referral DMs for high-scoring jobs.

## 🛠️ Tech Stack

- **Framework**: React Native, Expo
- **Database**: SQLite (via Expo SQLite), Drizzle ORM
- **Backend/Storage**: Supabase
- **Data Scraping**: Apify Actors
- **AI / LLM**: Amazon Bedrock

## 📦 Installation & Setup

1. **Clone the repository**
   ```bash
   git clone <repository_url>
   cd WhinJob
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   Set up your `.env` file with the necessary keys (e.g., Supabase endpoints if applicable). The core AI and scraping capabilities require you to provide your **Apify Token** and **Bedrock API Key** directly into the in-app Settings screen (secured via Expo SecureStore).

4. **Generate Database Migrations**
   ```bash
   npm run db:generate
   ```

5. **Start the Development Server**
   ```bash
   npm start
   # Or directly run for a specific platform:
   npm run android
   npm run ios
   ```

## 🏗️ Available Scripts

- `npm start` - Starts the Expo development server.
- `npm run verify` - Runs TypeScript type checking and ESLint to verify code quality.
- `npm run db:generate` - Generates Drizzle ORM database migrations.
- `npm run build:dev` - Triggers a development build via EAS (Expo Application Services).
- `npm run lint` - Lints the codebase using ESLint.

## 📝 How It Works

1. **Setup**: Add your resume and configure your API keys (Apify, Bedrock) within the app settings.
2. **Query Expansion**: The app uses your resume and preferences to generate a broad array of search terms and location aliases.
3. **Fetching**: It triggers Apify actors to parallel-scrape top job boards.
4. **Deduplication & Pre-filtering**: Results are merged, duplicates are collapsed, and irrelevant jobs are filtered out locally (e.g., based on experience mismatches) to save costs.
5. **AI Scoring**: Top candidates are sent to Amazon Bedrock to get scored across various rubrics (Skills, Experience, etc.).
6. **Apply**: You can tap on strong matches to view a "Deep Analysis" or generate an "Apply Kit" with customized cover notes and answers.

## 📜 License
See the [LICENSE](file:///g:/job_hunt_assistant%20-%20Copy/WhinJob/LICENSE) file for more details.
