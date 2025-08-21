import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { JobManager } from '../../shared/job-manager.js';

export async function jobStatusHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Job status request received');

  try {
    const jobId = request.params.jobId;
    
    if (!jobId) {
      return {
        status: 400,
        body: JSON.stringify({ error: 'Job ID is required' })
      };
    }

    const jobManager = new JobManager();
    const job = await jobManager.getJob(jobId);

    if (!job) {
      return {
        status: 404,
        body: JSON.stringify({ error: 'Job not found' })
      };
    }

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jobId: job.rowKey,
        status: job.status,
        progress: job.progress,
        inputType: job.inputType,
        inputSource: job.inputSource,
        fileName: job.fileName,
        fileSize: job.fileSize,
        mimeType: job.mimeType,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        errorMessage: job.errorMessage,
        results: job.results
      })
    };

  } catch (error) {
    context.log('Failed to get job status:', error);
    return {
      status: 500,
      body: JSON.stringify({ 
        error: 'Failed to get job status', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      })
    };
  }
}

export async function jobListHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Job list request received');

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const projectId = url.searchParams.get('projectId');
    const limit = parseInt(url.searchParams.get('limit') || '50');

    if (!userId) {
      return {
        status: 400,
        body: JSON.stringify({ error: 'User ID is required' })
      };
    }

    const jobManager = new JobManager();
    const result = await jobManager.getUserJobs(userId, projectId || undefined, limit);

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jobs: result.jobs.map(job => ({
          jobId: job.rowKey,
          status: job.status,
          progress: job.progress,
          inputType: job.inputType,
          inputSource: job.inputSource,
          fileName: job.fileName,
          fileSize: job.fileSize,
          mimeType: job.mimeType,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          errorMessage: job.errorMessage,
          results: job.results
        })),
        totalJobs: result.jobs.length,
        continuationToken: result.continuationToken
      })
    };

  } catch (error) {
    context.log('Failed to get job list:', error);
    return {
      status: 500,
      body: JSON.stringify({ 
        error: 'Failed to get job list', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      })
    };
  }
}

export async function jobDeleteHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Job delete request received');

  try {
    const jobId = request.params.jobId;
    
    if (!jobId) {
      return {
        status: 400,
        body: JSON.stringify({ error: 'Job ID is required' })
      };
    }

    const jobManager = new JobManager();
    
    // Check if job exists first
    const job = await jobManager.getJob(jobId);
    if (!job) {
      return {
        status: 404,
        body: JSON.stringify({ error: 'Job not found' })
      };
    }

    await jobManager.deleteJob(jobId);

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Job deleted successfully',
        jobId
      })
    };

  } catch (error) {
    context.log('Failed to delete job:', error);
    return {
      status: 500,
      body: JSON.stringify({ 
        error: 'Failed to delete job', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      })
    };
  }
}

export async function jobStatsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Job stats request received');

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const projectId = url.searchParams.get('projectId');

    const jobManager = new JobManager();
    const stats = await jobManager.getJobStats(userId || undefined, projectId || undefined);

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(stats)
    };

  } catch (error) {
    context.log('Failed to get job stats:', error);
    return {
      status: 500,
      body: JSON.stringify({ 
        error: 'Failed to get job stats', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      })
    };
  }
}

// Register HTTP functions
app.http('job-status', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'jobs/{jobId}/status',
  handler: jobStatusHandler
});

app.http('job-list', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'jobs',
  handler: jobListHandler
});

app.http('job-delete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'jobs/{jobId}',
  handler: jobDeleteHandler
});

app.http('job-stats', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'jobs/stats',
  handler: jobStatsHandler
});

// Add alias for frontend compatibility
app.http('job-list-alias', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'jobs/list',
  handler: jobListHandler
});
